# Roll/Vinyl migrate pass — investigation & proposal (read-only)

**Status: investigation and proposal only. No files under `src/` or `supabase/migrations/` were
changed. No SQL was run against production. Nothing was written to the database.** This document
is the deliverable; it is meant to be read, then acted on (or not) as separate, explicit build
work.

Org: `4ca12dff-97be-4472-8099-ab102a3af01a`. All counts below come from live, paginated queries
against `shopvox_materials` (Roll Materials type, status = NEW) run today. Every query used
explicit `.range()` pagination in 1000-row pages — no query in this investigation could have
silently truncated.

---

## Problem 1 — the migrate screen is blind to any type but one

### Root cause (confirmed, file:line)

`src/app/(dashboard)/dashboard/[slug]/settings/materials/migrate/page.tsx`:

- Line 37-39: the page looks up **one** material type by hardcoded name —
  `.eq('name', SUBSTRATE_TYPE_NAME)` (`"Rigid Substrates- Sheets"`).
- Line 48: every row fetch is filtered `.eq('material_type_id', substrateType.id)`.

There is no type picker. Any `shopvox_materials` row whose `material_type_id` isn't that one type
is invisible to this screen, full stop — not filtered-and-shown-as-zero, just never fetched. This
is exactly what hid the 5 "Substrates" rows found in the prior investigation, and it's why the 368
NEW "Roll Materials" rows have never been reachable from this UI at all.

The tab counter (`migrate-client.tsx` line 368, `{t} ({rowsByStatus[t].length})`) counts whatever
`page.tsx` handed it — so it is only ever a true count **of the one hardcoded type**, never of the
org. It cannot currently under-report *within* a type (Phase 6 confirmed `buildFamilyProposals`
never drops a row), but it silently under-reports **at the type level**, by 100%, for every type
except Substrates.

### Proposed minimal change

Three additions, deliberately small — this is a migration tool with a limited lifespan, not a
product surface:

**(a) Type picker.** Replace the hardcoded `substrateType` lookup with a fetch of all
`material_types` for the org (paginated), and a plain `<select>` (or tab strip, matching the
existing NEW/CHANGED/MIGRATED/DISMISSED tabs visually) driven by a `type` URL search param —
`?type=<material_type_id>`, defaulting to the first type that actually has NEW rows (see counter
proposal below) rather than defaulting to Substrates. No new table, no new state store — the URL
param is the only new piece of state, consistent with how this screen already treats tabs.

**(b) Per-type parser config selection.** `buildFamilyProposals` already takes a `FamilyAxisConfig`
as a parameter (Phase 3's generalization). Add one small lookup:

```ts
const FAMILY_CONFIGS: Record<string, FamilyAxisConfig> = {
  [SUBSTRATE_TYPE_NAME]: SUBSTRATE_FAMILY_CONFIG,
  ['Roll Materials']: ROLL_FAMILY_CONFIG, // proposed below, item 2
}
```

keyed by type name (or type id, whichever `page.tsx` already resolves). If the selected type has
no entry, the UI shows the raw NEW rows in a flat list (no grouped proposals) with a visible
banner — "no parser configured for this type yet" — rather than either crashing or silently
falling back to the substrate parser and producing garbage groupings. That fallback banner is the
whole answer to "what happens for the other 19 material types nobody has looked at yet" — it's
explicit and it's cheap, and it doesn't require writing 19 configs before this ships.

**(c) A counter that cannot silently under-report.** Two changes, both small:

1. Fetch NEW-row counts for **every** material type up front (one paginated count-only query,
   grouped client-side by `material_type_id`), and show that count next to each entry in the type
   picker — *before* the user even picks a type. This is what would have surfaced the 5 hidden
   Substrates rows immediately, instead of requiring a support investigation.
2. Within the selected type, keep today's "NEW (n)" tab count, but change what `n` counts: today
   it's `rows.filter(r => r.status === 'NEW').length` from whatever `page.tsx` fetched for that
   one type — correct, but only because `page.tsx` fetches unpaginated (no `.range()`/`.limit()`
   anywhere in that file, flagged in the prior investigation as a latent truncation risk once any
   type exceeds 1000 NEW rows). Roll Materials NEW count (368) doesn't hit that ceiling today, but
   nothing stops it. Fix: add explicit pagination to `page.tsx`'s row fetch (a `fetchAll` helper,
   same shape used throughout this investigation) so "NEW (n)" is mechanically incapable of
   truncating at 1000, for any type, ever.

That's the full proposal for Problem 1: a type param + picker, a small per-type config map with an
explicit "unconfigured" fallback, and paginating the one query that currently isn't. No new
tables, no new components beyond the picker, no schema change.

---

## Problem 2 — the roll parser config

Per instruction, `src/lib/material-family-proposals.ts` lines 448-477 ("WHAT A ROLL PASS...WOULD
STILL NEED") was read first. Its four anticipated needs are addressed directly below: (1) a
concrete `ROLL_FAMILY_CONFIG`, (2) `extractSize` returning width-only with a length-increment
question closed out, (3) confirmation the existing `COLOUR_CODE_RE` shape holds, (4) this report
itself as the pre-build gate.

All counts below are over the full 368 NEW "Roll Materials" rows (368 total; 359 with `width` and
`sheet_cost` populated; 359 with `width` alone; 359 with `sheet_cost` alone; 368 with `multiplier`
populated — all confirmed exactly, matching the numbers given in the request).

### (a) Identity axis — one axis or two?

Two mutually exclusive naming families, confirmed by direct regex count over all 368 raw names:

| Pattern | Count |
|---|---|
| `NNoz` (weight, e.g. `19.5oz`, `13oz`) | 48 |
| `NMil` (thickness, e.g. `3.5Mil`, `2Mil`) | 224 |
| Both in the same name | **0** |
| Neither in the raw name | 96 |

Weight (oz) is used by fabric/banner-class products (Banner, Mesh, Canvas, Fabric). Thickness
(Mil) is used by vinyl/film/laminate-class products. These are genuinely two different
conventions for two different product families, not one axis spelled two ways — this matches the
substrate precedent of a single `axisLabel`/`findAxisStart` pair, except here the axis is
**detected**, not fixed, so `ROLL_FAMILY_CONFIG.findAxisStart` needs to try both patterns.

Of the 96 with neither token in the raw name, 7 are cases where the axis is *constant across every
row in that category* (e.g. every "Banner Mesh" row is `8oz`) and gets absorbed into the
per-category common-prefix line rather than left in the per-row remainder — a structural
non-failure, not a parse miss (see the dry-run methodology note below). That leaves **89 rows with
truly no detectable axis token anywhere** — broken down by category:

| Category | No-axis rows |
|---|---|
| Vinyl Kiss Cut- Intermediate Calendared | 29 |
| Pre-Mask Tape | 21 |
| Vinyl Kiss Cut- Cast/ High Performance | 12 |
| Vinyl Kiss Cut- Specialty | 7 |
| Vinyl Kiss Cut- Reflective | 7 |
| Vinyl Digital- Removable & Repositionable | 3 |
| Wallpaper- Dreamscape | 3 |
| Vinyl Digital- Regular Calandered | 2 |
| Vinyl Kiss Cut- Solid Wrap Cast Color Change | 2 |
| Banner | 1 |
| G Floor Graphic | 1 |
| (Grommet, uncategorized) | 1 |

Pre-Mask Tape and Wallpaper genuinely carry no weight/thickness in the product name — that's
real, not a bug. The vinyl-category singles are mostly rows named only by brand/model
(e.g. "Vinyl Cast — 3M 180Cv3") with the thickness omitted from that particular row's text even
though sibling rows in the same category state it. These 89 rows should land as LOW-confidence
singletons for manual review, exactly like the substrate pass's ungrouped rows — never silently
dropped, never silently grouped on a guess.

### (b) Size token (roll width) — parse failures

Using `WIDTH_RE = /(\d+(?:\.\d+)?)\s*(in|")/i` against the raw name, falling back to the DB
`width` column when the name has no in-text token: **367 of 368 rows resolve a width.** Exactly
**one name fails outright — with no text token and no DB fallback**:

- `"Grommet"` (width = NULL, height = NULL, sheet_cost = NULL in the DB)

That's the complete list — it is a single row, not an estimate. "Grommet" is not a roll product at
all; it's an accessory/finishing item miscategorized under the Roll Materials type. It should
surface as a LOW-confidence singleton with an explicit "not a sized roll product" reasoning
string, same as any other unparseable row — never invented, never dropped.

(Separately, 9 rows have `width = NULL` in the DB and rely entirely on the in-name text token —
listed in full under (d) below, since that's the same set relevant to the cut-to-length question.)

### (c) Quote-inch convention (`38"` vs `"38in"`)

Exactly **one row** uses a bare quote-mark for inches without the word "in" anywhere in the name:

- `"Roodle Matte White Removable 54" x 100"`

This is precisely the risk flagged from the Phase 6 THICKNESS_START_RE finding (a quote-inch
notation silently misparsed as colour text) — confirmed real here, but narrow: 1 row out of 368.
The proposed `ROLL_FAMILY_CONFIG`'s width regex includes `"` as an accepted unit character from the
start (see code below), so this row parses correctly under the proposed config; it's called out
here because the substrate config's `THICKNESS_START_RE` did **not** have this and must not be
reused unmodified for rolls.

### (d) Cut-to-length (length_increment)

Checked directly: **no true continuous-cut-to-length pattern exists in this dataset.** The
Polycarbonate precedent (migration-era bug) was triggered by rows with *both* `height` and `width`
NULL in the DB, sized only by an open-ended reel length. The equivalent check here:

9 rows have `width = NULL` in the DB. All 9 also have `height = NULL` — so by the DB-columns
signal alone they look like Polycarbonate candidates. But 8 of the 9 carry an explicit, discrete
width **in the product name itself** (a specific stock roll width, not a continuous length):

```
Banner Translucent 19.5oz Arlon DPF 390 102in
Banner Translucent 19.5oz Arlon DPF 390 126in
Banner Translucent 19.5oz Arlon DPF 390 150in
Banner Translucent 19.5oz Arlon DPF 390 192in
Banner Translucent 19.5oz Arlon DPF 390 54in
Banner Translucent 19.5oz Arlon DPF 390 78in
Taillight Tint Mid Smoke (60262) Luxe Light Wrap 20in
Vinyl Gold Leaf 4Mil Avery SF100 15in
```
(the 9th is "Grommet", already covered under (b) — no width signal of any kind).

These 8 "Banner Translucent" rows in particular are six *discrete stock widths* of the same
product (102/126/150/192/54/78 in) — i.e. exactly the shape a normal family/variant grouping
already handles (one family, six width variants), not a cut-to-length product. **Detection rule
for a real cut-to-length product, if one ever appears in this type:** DB `width IS NULL` **and**
no width/inch token anywhere in the name **and** `sheet_cost`/price is clearly length-scaled (e.g.
priced per linear foot) — none of the 368 rows meet all three. Until a row does,
`ROLL_FAMILY_CONFIG` does not need a `length_increment` detection path at all; if one is added
later for a new row that fails all size detection, the safe behavior (matching the "fail loudly"
rule) is to leave `length_increment` NULL and flag the row LOW-confidence for manual entry — never
guess a reel length.

### (e) Colour/finish

The existing `COLOUR_CODE_RE = /^(.*?)\(([A-Za-z0-9][A-Za-z0-9-]*)\)(.*)$/` generalizes to rolls
as-is — confirmed against real names, e.g. `Taillight Tint Mid Smoke (60262)` parses to colour
`"Mid Smoke"` / code `"60262"` exactly like the substrate `ColourName (CODE)` shape. **No change
needed to that regex.**

What rolls need that substrates never did: a **brand/product-line token** — e.g. `Oracal 651`,
`Avery SW900`, `3M 180C`, `Arlon DPF 390` — sitting structurally *between* the colour/code and the
width token. On substrates this space was empty; on rolls it's a real, family-distinguishing
property (the same colour on two different brands' vinyl are different materials — different
cost, different multiplier, sometimes different width availability). Concretely:

```
[colour + optional (code)] [BRAND/PRODUCT LINE] [width token]
 Busmark5800                General Formulations   54in
```

This means `FamilyAxisConfig` as it exists today (axis + size only) is not quite sufficient for
rolls — the proposed config below extracts brand as a **third**, separate captured field and folds
it into the family-grouping key (not the colour, not the axis). That's flagged as the one place
where the roll pass needs slightly more than a new config *value* — it needs the extraction
function to return one more field. The type itself doesn't need to change (`brand` can be an
optional field on the existing return shape), so this does not ripple into `page.tsx` or the UI.

### Proposed `ROLL_FAMILY_CONFIG` (proposed only — not added to `src/`)

```ts
// Proposed addition to src/lib/material-family-proposals.ts. NOT committed.
const ROLL_AXIS_RE = /(\d+(?:\.\d+)?)\s*(oz|mil)\b/i
const ROLL_WIDTH_RE = /(\d+(?:\.\d+)?)\s*(in|")/i          // includes bare quote-inch, see (c)
const ROLL_WIDTH_X_LENGTH_RE = /(\d+(?:\.\d+)?)\s*(in|")\s*x\s*(\d+(?:\.\d+)?)\s*(in|")/i

const ROLL_FAMILY_CONFIG: FamilyAxisConfig = {
  axisLabel: 'Weight/Thickness',
  findAxisStart(remainder) {
    const m = ROLL_AXIS_RE.exec(remainder)
    return m ? m.index : -1
  },
  extractSize(row) {
    // Try width x length first (discrete stock sheets living inside this type,
    // e.g. "G Floor" — see note below), then bare width, then DB width fallback.
    const wl = ROLL_WIDTH_X_LENGTH_RE.exec(row.name)
    if (wl) return { /* ... width + length from wl ... */ }
    const w = ROLL_WIDTH_RE.exec(row.name)
    if (w) return { /* ... width from w, nameWithoutSize with token removed ... */ }
    if (row.width != null) return { /* ... width from row.width, DB-fallback flag ... */ }
    return { nameWithoutSize: row.name, sizeLabel: null, height: null, width: null, lengthIncrement: null }
  },
  // Proposed extension: an optional third extractor for the brand/product-line
  // token described in (e), returned alongside axis/size and folded into the
  // family key — not part of today's FamilyAxisConfig shape, would need adding.
}
```

**One refinement surfaced during the dry-run, not yet in the regex above:** `ROLL_WIDTH_X_LENGTH_RE`
only recognizes `in`/`"` units. Two "G Floor" rows are sized in feet (`4ft x 8ft`, `5ft x 10ft`) —
these fell through to the DB-width fallback (correctly, just not via the text token) and were
flagged MEDIUM confidence for review rather than silently mis-sized. Worth adding an `ft` unit to
the width regex before a real build, but it's not a blocker — the fallback caught it safely.

---

## Dry-run grouping report (368 rows, proposed config, live data)

Methodology: same `buildFamilyProposals` structure as substrates — hard partition by
`category_id`, per-category longest-common-prefix "line", axis + width + brand extraction per row,
grouped by (line, axis, width, brand). No row is ever dropped; every row lands in a family, worst
case a LOW-confidence singleton. 51 distinct categories (vs. substrates' 19).

**Totals:**

| | Families | Rows |
|---|---|---|
| High confidence | 76 | 249 |
| Medium confidence | 2 | 6 |
| Low confidence | 113 | 113 |
| **Total** | **191** | **368** |

249 + 6 + 113 = 368 — exact, confirmed.

### Top 15 high-confidence families (by row count)

| Rows | Line | Axis | Brand | Category |
|---|---|---|---|---|
| 32 | Vinyl | 2Mil | Avery UC900 | Vinyl Kiss Cut- Translucent |
| 24 | Vinyl Intermediate | 2.5Mil | Oracal 651 | Vinyl Kiss Cut- Intermediate Calendared |
| 19 | Vinyl Wrap | 3.2Mil | Avery SW900 | Vinyl Kiss Cut- Solid Wrap Cast Color Change |
| 9 | Vinyl Cast | 2Mil | Oracal 751C | Vinyl Kiss Cut- Cast/ High Performance |
| 8 | Laminate Regular 3.2Mil NLC | 3.2Mil | — | Laminate- Regular Calendared |
| 8 | Vinyl Frost | 3Mil | Oracal 8510 | Vinyl Kiss Cut- Frost |
| 7 | Banner Mesh 8oz | 8oz | — | Banner- Mesh |
| 7 | Banner | 13oz | Forward | Banner- Single Sided |
| 6 | Banner Translucent | 19.5oz | Arlon DPF 390 | Banner- Translucent |
| 5 | Canvas | 8.4oz | — | Canvas |
| 5 | Fabric | 7.1oz | — | Fabric- Frontlit |
| 5 | Vinyl | 2Mil | 3M 3630 | Vinyl Kiss Cut- Translucent |
| 4 | Banner Blockout 18oz Pole Banner | 18oz | — | Banner- Blockout (Double Sided) |
| 4 | Film Translucent 7Mil Magic SBL-7 | 7Mil | — | Translucent Backlit Film |
| 4 | Laminate | 2.1Mil | Avery 1060Z Gloss | Laminate- Wrap Digital Cast |

Spot-checked on the raw names (32-row, 24-row, 19-row, 9-row families): each correctly separates
by brand and thickness, with multiple stock widths preserved as distinct size variants within the
family rather than collapsed — the same shape as the accepted substrate families in Build 1b.

### Medium-confidence families (both, reviewed)

1. **4 rows**, line "Vinyl Bus Short Term", axis `3.5Mil` (constant per category, not a per-row
   miss), category "Vinyl Digital- Short Term" — flagged because the leading colour-text token
   "Busmark5800" starts with a digit (possible grade code, not a colour name), same heuristic as
   the substrate pass's "P95" catch. Real signal, worth a human glance.
2. **2 rows**, line "G Floor", axis `75Mil`, category "G Floor Graphic" — the two feet-sized rows
   from the width-regex gap noted above ("4ft x 8ft Clear Diamond Tread", "5ft x 10ft Clear
   Diamond Tread"). DB-width fallback caught the size (96in/120in) but the leading text still reads
   as a possible grade code. Also worth a human glance, and a nudge to add `ft` to the width regex.

### Low-confidence families (113 singletons — no row grouped on a guess)

| Reason | Rows |
|---|---|
| No axis (weight/thickness) token anywhere in the name, genuinely absent | 89 |
| Category has only 1 NEW row total (nothing to group against) | 14 |
| Category has only 2 NEW rows total | 10 |

The 89 no-axis rows are broken down by category under item (a) above. Every one of the 113 lands
as its own singleton proposal, carrying a `reasoning` string explaining exactly why (matching the
substrate pass's UI pattern) — none are dropped, none are silently grouped.

---

## Files touched this session

None. This was a read-only investigation. Temporary scratch scripts used to query the database and
compute the above (`scripts/_tmp_roll_dump.mjs`, `scripts/_tmp_roll_names.json`,
`scripts/_tmp_roll_dryrun.mjs`, `scripts/_tmp_roll_dryrun_output.txt`) have been deleted.

`git status --porcelain` was checked before finalizing this report and shows no changes to any
file under `src/` or `supabase/migrations/`.
