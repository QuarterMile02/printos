# Channel Letter Materials — investigation & dry run (read-only)

**Status: investigation and dry run only. No files under `src/` or `supabase/migrations/` were
changed. No SQL was run against production. Nothing was written to the database.** All queries used
explicit `.range()` pagination in 1000-row pages.

Org: `4ca12dff-97be-4472-8099-ab102a3af01a`. Type: `Channel Letter Materials`
(`f8c074d2-ed8e-4c2e-9dff-357350d4d960`), 54 rows, `status = 'NEW'`. Live re-query today confirms
the data is unchanged since the prior pass on this type — same 54 rows, same costs/multipliers —
so this report supersedes and extends that one rather than duplicating it, with (1) real
file:line evidence for why a third config is needed, (2) a brand-split dry run per that report's
own recommendation, and (3) a script-verified (not hand-counted) family grouping.

---

## (a) All 54 names, in full

Categories: Trim Cap (30), Return Coil (19), Wall Pass Thru (1), Misc. Supplies (2), Trim Cap Glue
(2) — 30+19+1+2+2 = 54.

```
Black / Trimp Cap                                   [disabled] Trim Cap        cost=0.0333 sheet_cost=5     mult=15.015
Bronze / Trimp Cap                                  [disabled] Trim Cap        cost=0.0066 sheet_cost=1     mult=0.5
Bronze 313 / Trimp Cap                              [disabled] Trim Cap        cost=0.0400 sheet_cost=6     mult=0
Brown / Trimp Cap                                   [disabled] Trim Cap        cost=0.0333 sheet_cost=5     mult=0
Brushed Chrome / Trimp Cap                          [disabled] Trim Cap        cost=0.0333 sheet_cost=5     mult=0
Burgundy / Trimp Cap                                [disabled] Trim Cap        cost=0.0333 sheet_cost=5     mult=0
Channel Letter Wall Buster Paige White 50Pk         [enabled]  Wall Pass Thru  cost=3.32   sheet_cost=null  mult=2
Chrome / Trimp Cap                                  [disabled] Trim Cap        cost=0.0333 sheet_cost=5     mult=0
Coil .040 Black 3.5in x 270ft                       [enabled]  Return Coil     cost=0.0795 sheet_cost=257.47 mult=3
Coil .040 Black 5.3in x 270ft                       [enabled]  Return Coil     cost=0.1061 sheet_cost=343.83 mult=3
Coil .040 Blue 5.3in x 270ft                        [enabled]  Return Coil     cost=0.1099 sheet_cost=356.19 mult=3
Coil .040 Bright Brush Silver/White 3.5in x 270ft   [enabled]  Return Coil     cost=0.1366 sheet_cost=442.45 mult=2.5
Coil .040 Bronze/White 3.5in x 270ft                [enabled]  Return Coil     cost=0.0728 sheet_cost=236   mult=3
Coil .040 Caution Yellow 5.3in x 270ft              [enabled]  Return Coil     cost=0.1061 sheet_cost=343.83 mult=3
Coil .040 Chevron Blue 5.3in x 270ft                [enabled]  Return Coil     cost=0.0912 sheet_cost=295.52 mult=3
Coil .040 Gold Mirror/White 3.5in x 270ft           [enabled]  Return Coil     cost=1.8568 sheet_cost=501.34 mult=2
Coil .040 Mill 3.5in x 270ft                        [disabled] Return Coil     cost=0.0735 sheet_cost=238.21 mult=3
Coil .040 Mill 3in x 270ft                          [enabled]  Return Coil     cost=0.0827 sheet_cost=267.91 mult=3
Coil .040 Mill 5.3in x 270ft                        [enabled]  Return Coil     cost=0.0735 sheet_cost=238.21 mult=3
Coil .040 Orange 5.3in x 270ft                      [enabled]  Return Coil     cost=0.1061 sheet_cost=343.83 mult=3
Coil .040 Red 5.3in x 270ft                         [enabled]  Return Coil     cost=0.1099 sheet_cost=356.19 mult=3
Coil .040 White 3.5in x 270ft                       [enabled]  Return Coil     cost=0.0795 sheet_cost=257.47 mult=3
Coil .040 White 5.3in x 270ft                       [enabled]  Return Coil     cost=1.3178 sheet_cost=355.80 mult=3
Coil .063 Black 5.3in x 270ft                       [enabled]  Return Coil     cost=0.1055 sheet_cost=341.67 mult=3
Coil .063 Mill 3in                                  [enabled]  Return Coil     cost=0.0827 sheet_cost=267.91 mult=3
Coil .063 Mill 5in x 270ft                          [enabled]  Return Coil     cost=0.1107 sheet_cost=358.60 mult=3
Coil .063 Mill 6in x 270ft                          [enabled]  Return Coil     cost=0.1222 sheet_cost=398.25 mult=3
Custom / Trimp Cap                                  [disabled] Trim Cap        cost=0      sheet_cost=0     mult=0
Gold / Trimp Cap                                    [disabled] Trim Cap        cost=0.0333 sheet_cost=5     mult=0
Green (Solid) / Trimp Cap                           [disabled] Trim Cap        cost=0.0333 sheet_cost=5     mult=0
Hi Green / Trimp Cap                                [disabled] Trim Cap        cost=0.0333 sheet_cost=5     mult=0
Hunter Green / Trimp Cap                            [disabled] Trim Cap        cost=0.0366 sheet_cost=5.5   mult=0
Intense Blue / Trim Cap                             [disabled] Trim Cap        cost=0.0333 sheet_cost=5     mult=0
Metallic Silver / Trimp Cap                         [disabled] Trim Cap        cost=0.0333 sheet_cost=5     mult=0
Orange / Trimp Cap                                  [disabled] Trim Cap        cost=0.0400 sheet_cost=6     mult=0
SealTite Conduit                                    [enabled]  Misc. Supplies  cost=5      sheet_cost=null  mult=2
Spacers                                              [enabled]  Misc. Supplies  cost=0.25   sheet_cost=null  mult=4
Teal / Trimp Cap                                    [disabled] Trim Cap        cost=0.0333 sheet_cost=5     mult=0
Trim Cap - 1"                                       [disabled] Trim Cap        cost=0.35   sheet_cost=null  mult=2.8571
Trim Cap Black 1in Jewelite                         [enabled]  Trim Cap        cost=0.0362 sheet_cost=65.24 mult=4.5
Trim Cap Black 2in Jewelite                         [enabled]  Trim Cap        cost=0.0502 sheet_cost=90.40 mult=4
Trim Cap Blue 1in Jewelite                          [enabled]  Trim Cap        cost=0.0361 sheet_cost=65.10 mult=4
Trim Cap Glue IPS Weld-On 16 Pint                   [enabled]  Trim Cap Glue   cost=0.0704 sheet_cost=null  mult=3
Trim Cap Glue IPS Weld-On 3 Quart                   [enabled]  Trim Cap Glue   cost=0.2032 sheet_cost=null  mult=3
Trim Cap Lime Green 1in Jewelite                    [enabled]  Trim Cap        cost=0.0378 sheet_cost=67.99 mult=4
Trim Cap Mustard 1in Jewelite                       [enabled]  Trim Cap        cost=0.0313 sheet_cost=56.40 mult=4.63
Trim Cap Orange 1in Jewelite                        [enabled]  Trim Cap        cost=0.0313 sheet_cost=56.40 mult=4.63
Trim Cap Red 1in Jewelite                           [enabled]  Trim Cap        cost=0.0362 sheet_cost=65.10 mult=4
Trim Cap Red 2in Jewelite -                         [enabled]  Trim Cap        cost=0.0707 sheet_cost=84.86 mult=4
Trim Cap Silver Metallic (8886) 1in Gemini          [enabled]  Trim Cap        cost=0.0362 sheet_cost=65.10 mult=4
Trim Cap White 1in Jewelite                         [enabled]  Trim Cap        cost=0.0362 sheet_cost=65.15 mult=4
Trim Cap White 2in Jewelite                         [enabled]  Trim Cap        cost=0.0502 sheet_cost=90.40 mult=4
True Red / Trimp Cap                                [disabled] Trim Cap        cost=0.0333 sheet_cost=5     mult=0
Yellow / Trimp Cap                                  [disabled] Trim Cap        cost=0.0333 sheet_cost=5     mult=0
```

(Sorted alphabetically for readability; `shopvox_status` has exactly two distinct live values,
`enabled`/`disabled`, confirmed directly.)

## (b) The "`<colour> / <product>`" shape — real counts, every exception

**18 of 54** match the literal ` / ` separator (with spaces — deliberately does not collide with
slash-joined colour names like "Bronze/White" or "Gold Mirror/White", which have no spaces around
the slash). **36 of 54** do not. Every exception, grouped by its actual shape:

- **19 — `Coil .0XX <colour> <W>in x <L>ft`** (Return Coil). Product-first; the axis token sits
  *before* colour, not after it like substrates/rolls, and there's no separator at all.
- **11 — `Trim Cap <colour> <W>in <Brand>`** (Trim Cap, `Jewelite` ×10 / `Gemini` ×1). Product-first,
  no reversal, a trailing brand word.
- **2 — `Trim Cap Glue IPS Weld-On <size>`** (Trim Cap Glue). A different product entirely, not a
  colour variant of anything.
- **2 — `SealTite Conduit`, `Spacers`** (Misc. Supplies). No colour, no axis — two unrelated single
  items sharing a catch-all category.
- **1 — `Channel Letter Wall Buster Paige White 50Pk`** (Wall Pass Thru). Its own product,
  standalone.
- **1 — `Trim Cap - 1"`** (Trim Cap, disabled). Malformed: a dangling `-`, a quote-inch `1"` that
  matches no stored dimension (`width`/`height` both `NULL`), no colour at all.

18 + 19 + 11 + 2 + 2 + 1 + 1 = 54.

## (c) Identity axis — and why the existing configs can't parse this type

**No single uniform answer — splits cleanly by category, both halves real:**

- **Trim Cap** (30 rows, both shapes): confirmed, no axis at all. The family is the product itself
  ("Trim Cap"/"Trimp Cap"), colour is the only variation — matches the framing exactly.
- **Return Coil** (19 rows): **thickness IS a real, present axis** — every single name carries a
  bare-decimal gauge token, `.040` (15 rows) or `.063` (4 rows), in exactly the substrate's own
  `BARE_DECIMAL_THICKNESS_RE` shape (`src/lib/material-family-proposals.ts:141`,
  `/^\.\d{2,4}$/` — Aluminum Solid's `.040`/`.063`/`.080` gauge convention). This genuinely
  distinguishes SKUs — "the axis is not thickness" is correct for Trim Cap, but Return Coil is a
  different category inside the same type with a different, real axis.

**Why neither `SUBSTRATE_FAMILY_CONFIG` nor `ROLL_FAMILY_CONFIG` can parse either category, with
file:line evidence, not assumed:**

1. **`FamilyAxisConfig` itself assumes colour precedes axis.** The type's own doc comment
   (`material-family-proposals.ts:94–115`) states substrate's axis is "everything from
   `findAxisStart` to the end of the remainder — the trailing decoration on the name," and the
   substrate branch of `parseRemainder` (`material-family-proposals.ts:340–342`) computes
   `colour = remainder.slice(0, idx)`, `axisValue = remainder.slice(idx)` — a hard left-to-right
   assumption. For `"Coil .040 Black 3.5in x 270ft"`, the axis token `.040` sits at index 0 of the
   remainder (right after line `"Coil"`) — `idx = 0` makes `colour = ''` and `axisValue` swallow
   the *entire* rest of the string including the real colour (`Black`) and the size text. The
   colour is never recovered; it silently disappears into `axisValue`.
2. **The line-detection mechanism (`computeLcpWordCount`, `material-family-proposals.ts:421–431`)
   is front-anchored** — it computes the longest common *prefix*, word by word from index 0, across
   every row in the category. For the 18 reversed-shape Trim Cap rows, word 0 is a different colour
   on every row (`Black`, `Bronze`, `Brown`, ...) — the LCP is 0 words, so `line` would compute as
   empty. `buildFamilyProposals` (`:494`) then has nothing to anchor "Trim Cap"/"Trimp Cap" as the
   product identity; every row falls out as an unrelated singleton, and worse, whatever text *is*
   found later gets misread as colour+axis in the wrong order per point 1.
3. **`ROLL_FAMILY_CONFIG`'s `findAxisSpan` model doesn't fit either.** Rolls assume a *bounded
   token* axis followed by a trailing brand (`material-family-proposals.ts:103–108`,
   `:788–831`) — workable in principle for Return Coil's bounded `.040`/`.063` token, but rolls'
   `parseRemainder` branch (`:292–316`) still finds the axis token, then treats everything
   *before* it as colour and everything *after* it as brand — Return Coil's colour is *after* the
   axis, not before, so this would read `Coil .040 Black 3.5in x 270ft`'s colour as empty
   (nothing precedes `.040` once "Coil" is the line) and dump `"Black 3.5in x 270ft"` into `brand`
   — wrong field, same reversed-order problem as point 1, just relocated.

This is a structural mismatch, not a tuning problem — a third config needs an axis search that
works **regardless of position** (order-independent, not "before" or "after" a fixed point) and a
line-detection path that **does not depend on LCP prefix-matching** when the category's own naming
convention front-loads the variable part (colour) instead of the shared part (product).

## (d) Where size comes from

**48 of 54 rows carry width/height in the DB — confirmed, matches exactly.** The other 6 (all
`width = NULL AND height = NULL`): `Channel Letter Wall Buster Paige White 50Pk`, `SealTite
Conduit`, `Spacers`, `Trim Cap - 1"`, both `Trim Cap Glue` rows — genuinely sizeless "each"/"per
container" items, consistent with no size token in the name either.

For the 48 that do carry a size, text and DB agree on *presence* but carry different pieces, and in
one case actively **conflict on which column means what**:

- **Return Coil (19 rows)**: 18 of 19 names state both dimensions in text — `<width>in x
  <length>ft` (e.g. `3.5in x 270ft`). The DB stores this **with `width` and `height` swapped from
  what the name states**: `width = 3240` (270ft pre-converted to inches, 270×12) and `height = 3.5`
  (the actual cross-section width the name calls "in"). This is the *reverse* of the documented
  convention (migration 173: "width is ALWAYS inches... height is what length_uom governs"). Not
  silently normalized here — flagged as a real data-shape conflict a real build must resolve
  explicitly (which column is authoritative for grouping/storage), not something to guess past.
  One row, `"Coil .063 Mill 3in"`, has no `x ___ft` suffix in the name at all; its DB `width = 3240`
  still implies 270ft, so the DB is the more complete source for that one row.
- **Trim Cap "Jewelite/Gemini" rows (11)**: the name states only the width (`1in`/`2in`, matching
  DB `width` exactly). The length (DB `height = 1800`, or `1200` for one row) is never in the name —
  database-only.
- **Trim Cap reversed rows (18)**: no size token in the name whatsoever. Database-only — `width =
  1, height = 150` for nearly all; one (`Hi Green`) has `height = 0`; `Custom` has `width = 0,
  height = 0` (a placeholder record, all-zero, also zero cost and zero multiplier — see (g)).

No row invents a size from nothing, but "the name carries a size token" and "the DB has the
complete/authoritative value" are both true for different subsets, and the Return Coil
column-swap needs a decision before any real parse, not a silent pick.

## (e) Same product, different brands?

**Yes — real, worth flagging, though pricing doesn't unambiguously say "identical product."**

The `Trim Cap ... Jewelite` rows (10) and the single `Trim Cap Silver Metallic (8886) 1in Gemini`
row are the same product shape (1in trim cap) from two differently-named product lines. Cost
clustering, confirmed directly: Jewelite 1in rows run cost **0.0313–0.0378** / sheet_cost
**56.40–67.99**; the Gemini row is cost **0.0362** / sheet_cost **65.10** — squarely inside the
Jewelite cluster, not a distinct price tier. Reads as "similarly-priced alternative," not
"different vendor, different cost tier" — the same *shape* of finding as rolls' Avery/Oracal/3M
brands, far less dramatic. **This pass's dry run (below) splits them into two families by brand
anyway**, per the prior investigation's own recommendation not yet implemented at the time — kept
as two separate 10-row/1-row families rather than merged, since under-grouping costs a manual
merge later and over-grouping welds two real materials together silently (the same asymmetric-risk
argument the substrate config's own comments make, `material-family-proposals.ts:433–441`).

**A second, stronger signal, directly relevant**: colour names in the *disabled* reversed-shape set
overlap the *enabled* product-first set — confirmed live, 3 overlaps: `Black`/`Orange` both appear
in both sets, and `Trim Cap Black 2in Jewelite` also overlaps `Black`. Pricing is completely
unrelated between the two: `"Black / Trimp Cap"` has `sheet_cost = 5, multiplier = 15.015`;
`"Trim Cap Black 1in Jewelite"` has `sheet_cost = 65.24, multiplier = 4.5`. Same colour word,
unrelated pricing structure. Read together with (f)/(g), this looks like the disabled reversed-shape
rows are a stale, superseded ShopVOX naming generation for colours the enabled Jewelite rows now
represent — a well-evidenced hypothesis, not a fact, put in front of you rather than acted on.

## (f) The 20 disabled rows, listed separately

Confirmed: **exactly 20 of 54** have `shopvox_status = 'disabled'` (independent of, and unrelated
to, this project's own `status` generated column — every one of these 20 is still `status = 'NEW'`
here; ShopVOX's enable/disable flag and PrintOS's migrate-status are two different fields).

**18 of the 20** are reversed-shape Trim Cap rows — every reversed-shape row is disabled *except*
`Black` and `Bronze`:

```
Bronze 313 / Trimp Cap        cost=0.0400  sheet_cost=6.00   mult=0        [REFUSE, see (g)]
Brown / Trimp Cap             cost=0.0333  sheet_cost=5.00   mult=0        [REFUSE]
Brushed Chrome / Trimp Cap    cost=0.0333  sheet_cost=5.00   mult=0        [REFUSE]
Burgundy / Trimp Cap          cost=0.0333  sheet_cost=5.00   mult=0        [REFUSE]
Chrome / Trimp Cap            cost=0.0333  sheet_cost=5.00   mult=0        [REFUSE]
Custom / Trimp Cap            cost=0       sheet_cost=0      mult=0        [REFUSE -- literally all zero, width=0 height=0 too]
Gold / Trimp Cap              cost=0.0333  sheet_cost=5.00   mult=0        [REFUSE]
Green (Solid) / Trimp Cap     cost=0.0333  sheet_cost=5.00   mult=0        [REFUSE]
Hi Green / Trimp Cap          cost=0.0333  sheet_cost=5.00   mult=0        [REFUSE]
Hunter Green / Trimp Cap      cost=0.0366  sheet_cost=5.50   mult=0        [REFUSE]
Intense Blue / Trim Cap       cost=0.0333  sheet_cost=5.00   mult=0        [REFUSE]
Metallic Silver / Trimp Cap   cost=0.0333  sheet_cost=5.00   mult=0        [REFUSE]
Orange / Trimp Cap            cost=0.0400  sheet_cost=6.00   mult=0        [REFUSE]
Teal / Trimp Cap              cost=0.0333  sheet_cost=5.00   mult=0        [REFUSE]
True Red / Trimp Cap          cost=0.0333  sheet_cost=5.00   mult=0        [REFUSE]
Yellow / Trimp Cap            cost=0.0333  sheet_cost=5.00   mult=0        [REFUSE]
```

`Black / Trimp Cap` (multiplier=15.015) and `Bronze / Trimp Cap` (multiplier=0.5) are disabled too,
but pass the multiplier check — real, if unusual, multipliers (15x, and 0.5x which would sell
*below* cost — worth a glance).

**The other 2 disabled rows aren't the reversed shape at all**: `Coil .040 Mill 3.5in x 270ft`
(real data, multiplier=3, just disabled — looks like a near-duplicate of the enabled `Coil .040
Mill 5.3in x 270ft`, different width) and `Trim Cap - 1"` (the malformed placeholder from (b), no
size, disabled).

## (g) The 16 rows with a real cost and multiplier = 0 — listed

All 16 are reversed-shape and disabled, confirmed by direct query (0 rows have `multiplier = NULL`
in this type — every problem case here is an explicit `0`, not a missing value):

```
Bronze 313 / Trimp Cap        cost=0.0400  sheet_cost=6.00
Brown / Trimp Cap             cost=0.0333  sheet_cost=5.00
Brushed Chrome / Trimp Cap    cost=0.0333  sheet_cost=5.00
Burgundy / Trimp Cap          cost=0.0333  sheet_cost=5.00
Chrome / Trimp Cap            cost=0.0333  sheet_cost=5.00
Custom / Trimp Cap            cost=0       sheet_cost=0
Gold / Trimp Cap              cost=0.0333  sheet_cost=5.00
Green (Solid) / Trimp Cap     cost=0.0333  sheet_cost=5.00
Hi Green / Trimp Cap          cost=0.0333  sheet_cost=5.00
Hunter Green / Trimp Cap      cost=0.0366  sheet_cost=5.50
Intense Blue / Trim Cap       cost=0.0333  sheet_cost=5.00
Metallic Silver / Trimp Cap   cost=0.0333  sheet_cost=5.00
Orange / Trimp Cap            cost=0.0400  sheet_cost=6.00
Teal / Trimp Cap              cost=0.0333  sheet_cost=5.00
True Red / Trimp Cap          cost=0.0333  sheet_cost=5.00
Yellow / Trimp Cap            cost=0.0333  sheet_cost=5.00
```

Every one of these will be refused by the accept path (`multiplier = 0` treated exactly like
`NULL`, never invented) — you'll want to fix the multiplier in ShopVOX (or dismiss the row) before
attempting to migrate any of these 16, not after hitting the error. `Custom / Trimp Cap` is also
`cost = 0, sheet_cost = 0` — a placeholder record with nothing real to migrate at all, likely a
dismiss candidate regardless of the multiplier.

---

## Proposed `CHANNEL_LETTER_FAMILY_CONFIG`

**This does not fit the existing `FamilyAxisConfig` interface as a config *value* — the parsing
*algorithm* itself needs to branch by shape, not just supply new regexes.** Concretely, three
things a real implementation needs that neither substrate nor roll's `parseRemainder`/
`computeLcpWordCount` provide (see (c) for the file:line evidence each of these responds to):

1. **An explicit-separator split, tried first, per row.** When a name contains the literal ` / `
   (spaces required), split directly into `colour = before`, `line = after` — bypass LCP-derived
   `line` entirely for that row. This is what makes `"Black / Trimp Cap"` resolve to colour
   `"Black"` / line `"Trimp Cap"` without ever running `computeLcpWordCount` over a set of rows
   that share no common leading word.
2. **An order-independent axis search** for rows without that separator — search the whole
   remainder for a bounded axis token (Return Coil's bare-decimal `.040`/`.063`, reusing
   `BARE_DECIMAL_THICKNESS_RE` unmodified) wherever it sits, not just "after colour." Remove that
   token first; colour and size are extracted from what's left, in either order.
3. **A brand field, same mechanism rolls already have** (`findAxisSpan`'s trailing-brand model),
   applied to the *product-first* Trim Cap rows: `"Trim Cap Silver Metallic (8886) 1in Gemini"` →
   colour `"Silver Metallic (8886)"`, brand `"Gemini"` — distinct from the `Jewelite` rows, per
   (e)'s real-if-minor pricing distinction, rather than flattening both into one family.

**Not typo-corrected, per instruction**: `"Trimp Cap"` and `"Trim Cap"` are two different literal
strings throughout this proposal and the dry run below. The one row that already says `"Trim Cap"`
correctly (`Intense Blue / Trim Cap`) does **not** join the 17-row `"Trimp Cap"` line — it would
form its own separate 1-row line if it weren't already forced LOW for its zero multiplier. A
direct, visible consequence of the typo, shown rather than silently patched.

**`multiplier = 0` treated exactly like `NULL`**, including inside grouping, not just at accept
time — a zero-multiplier row is forced LOW/singleton with an explicit `REFUSE` reason, mirroring
`accept_family_proposal`'s own database-layer enforcement.

**Category `<= 2` rows forced LOW** — this is not a new invented rule for this type, it's the
*existing* `buildFamilyProposals` rule at `material-family-proposals.ts:552` (`"not enough
repetition to trust an automated line/colour-finish split"`), applied here for consistency. It's
what correctly keeps `Trim Cap Glue`'s two rows (`16 Pint` / `3 Quart`, genuinely two container
sizes of one product, tempting to auto-merge) as two singletons rather than one automated
2-row family — same conservative default the rest of the system already uses on sparse data.

## Dry-run grouping report — all 54 rows, script-verified

Ran a standalone script implementing the three points above (not the real `buildFamilyProposals` —
its fixed parse order doesn't fit this shape, see (c)) against the live 54-row dataset. Every row
accounted for exactly once, confirmed by an explicit row-count assertion in the script output
(`54 rows across 27 families`), not hand-counted.

| | Families | Rows |
|---|---|---|
| High | 5 | 32 |
| Medium | 0 | 0 |
| Low | 22 | 22 |
| **Total** | **27** | **54** |

*(The prior pass on this type reported 4 high-confidence families (32 rows) because it had not yet
implemented the brand split from point 3 above — Jewelite and Gemini were folded into one 11-row
family. This pass implements that split, so Jewelite (10) and Gemini (1) are now two separate
high-confidence families — 5 high families / 27 total, same 32/22 row split.)*

### The 5 high-confidence families

**`Coil` axis=`.040`** (15 rows, Return Coil) — Black, Blue, Bright Brush Silver/White,
Bronze/White, Caution Yellow, Chevron Blue, Gold Mirror/White, Mill (3 sizes, including the
disabled 3.5in variant), Orange, Red, White (2 sizes). Every row's bare-decimal axis token found
order-independently.

**`Trim Cap` brand=`Jewelite`** (10 rows, Trim Cap) — Black (2 sizes), Blue, Lime Green, Mustard,
Orange, Red (2 sizes, one with a stray trailing `-`), White (2 sizes).

**`Coil` axis=`.063`** (4 rows, Return Coil) — Black, Mill (3 sizes). Correctly a *separate* family
from `Coil .040` — Mill and Black both appear at both thicknesses without merging, confirming
thickness genuinely functions as the axis here.

**`Trimp Cap`** (2 rows, Trim Cap, reversed shape) — Black, Bronze. The only two reversed-shape
rows with a real, non-zero multiplier.

**`Trim Cap` brand=`Gemini`** (1 row, Trim Cap) — Silver Metallic (8886). Cleanly parsed
(colour+size+brand all resolved) despite being alone; kept separate from Jewelite per (e).

### The 22 low-confidence singletons

**16 — `REFUSE: multiplier is 0`** (all reversed-shape, full list in (g) above).

**6 — other reasons, one each:**

| Name | Reason |
|---|---|
| `Trim Cap - 1"` | malformed: no size available in text or stored data (also disabled) |
| `Channel Letter Wall Buster Paige White 50Pk` | only 1 row in its category (rule at `:552`) |
| `SealTite Conduit` | only 2 rows in its category, Misc. Supplies (rule at `:552`) |
| `Spacers` | only 2 rows in its category, Misc. Supplies (rule at `:552`) |
| `Trim Cap Glue IPS Weld-On 16 Pint` | only 2 rows in its category, Trim Cap Glue (rule at `:552`) |
| `Trim Cap Glue IPS Weld-On 3 Quart` | only 2 rows in its category, Trim Cap Glue (rule at `:552`) |

5 + 22 = 27 families, 32 + 22 = 54 rows — exact, script-confirmed, no row dropped or double-counted.

---

## Substrates and Roll Materials — unchanged, structurally guaranteed

`git status --short -- src/ supabase/migrations/` returns empty for this session — **zero files
under either path were touched**, investigation and dry run only, per instruction. This is a
stronger guarantee than re-running the live dry run again: nothing could have changed
`SUBSTRATE_FAMILY_CONFIG`, `ROLL_FAMILY_CONFIG`, or `buildFamilyProposals` when no file that
defines them was edited. (Also worth noting for continuity: Roll Materials' own NEW-row count
keeps moving as rows get migrated in production — re-running that dry run today would report a
different row count than any prior check for reasons unrelated to code, same as already flagged
in the roll-length-variant work.)

## Files touched this session

None under `src/` or `supabase/migrations/`. Read-only investigation and dry run only. All scratch
scripts that queried the database (`scripts/_tmp_channel_letter_investigate.mjs`,
`scripts/_tmp_channel_letter_dryrun.mjs`, and their output files `scripts/_tmp_cl_rows.json`,
`scripts/_tmp_cl_families.json`) have been deleted. `git status --porcelain` was checked before
finalizing this report and shows no changes to any file under `src/` or `supabase/migrations/`.
