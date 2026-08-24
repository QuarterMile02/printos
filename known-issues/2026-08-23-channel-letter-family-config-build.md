# Channel Letter Materials — `CHANNEL_LETTER_FAMILY_CONFIG` build report

Branch: `channel-letter-family-config` (off `main`, PRs #35/#36 already merged; not pushed to
`main`). Org: `4ca12dff-97be-4472-8099-ab102a3af01a`. Type: `Channel Letter Materials`
(`f8c074d2-ed8e-4c2e-9dff-357350d4d960`), 54 rows, `status = 'NEW'`, live-reconfirmed unchanged
since the investigation pass.

**No migration needed.** This is a pure `src/`-side addition — a new parser + a new UI wiring
branch in `page.tsx`. No RPC, no schema change, nothing to paste and run.

---

## The investigation-brief items, restated plainly (regardless of the code)

### a. All 54 names, in full

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

### b. The 16 rows with a real cost and multiplier = 0 — will be REFUSED

Every one of these will be rejected by the accept path (`multiplier = 0` treated exactly like
`NULL`, never invented) — fix the multiplier in ShopVOX (or dismiss the row) before clicking
accept on any of them, not after hitting the error:

```
Bronze 313 / Trimp Cap        cost=0.0400  sheet_cost=6.00
Brown / Trimp Cap             cost=0.0333  sheet_cost=5.00
Brushed Chrome / Trimp Cap    cost=0.0333  sheet_cost=5.00
Burgundy / Trimp Cap          cost=0.0333  sheet_cost=5.00
Chrome / Trimp Cap            cost=0.0333  sheet_cost=5.00
Custom / Trimp Cap            cost=0       sheet_cost=0        (also cost=0, width=0, height=0 -- placeholder record, likely a dismiss candidate outright)
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

(0 rows have `multiplier = NULL` in this type — every problem case here is an explicit `0`, not a
missing value. Confirmed by direct query, not assumed.)

### c. The 20 rows disabled in ShopVOX, listed separately

`shopvox_status = 'disabled'` — independent of, and unrelated to, this project's own `status`
generated column (every one of these 20 is still `status = 'NEW'` here). 18 of the 20 are the
reversed-shape rows (all 16 from (b) above, plus `Black` and `Bronze` — the only two reversed-shape
rows with a real, non-zero multiplier: 15.015 and 0.5 respectively, the latter unusual enough to
sell below cost, worth a glance). The other 2 disabled rows are `Coil .040 Mill 3.5in x 270ft`
(real data, multiplier=3, just disabled — looks like a near-duplicate of the enabled `Coil .040
Mill 5.3in x 270ft`) and `Trim Cap - 1"` (the malformed row, no size, disabled):

```
Black / Trimp Cap              cost=0.0333  sheet_cost=5.00   mult=15.015  [real multiplier -- unusual, high]
Bronze / Trimp Cap             cost=0.0066  sheet_cost=1.00   mult=0.5     [real multiplier -- would sell below cost]
Bronze 313 / Trimp Cap         cost=0.0400  sheet_cost=6.00   mult=0       [REFUSE, see (b)]
Brown / Trimp Cap              cost=0.0333  sheet_cost=5.00   mult=0       [REFUSE]
Brushed Chrome / Trimp Cap     cost=0.0333  sheet_cost=5.00   mult=0       [REFUSE]
Burgundy / Trimp Cap           cost=0.0333  sheet_cost=5.00   mult=0       [REFUSE]
Chrome / Trimp Cap             cost=0.0333  sheet_cost=5.00   mult=0       [REFUSE]
Coil .040 Mill 3.5in x 270ft   cost=0.0735  sheet_cost=238.21 mult=3       [real data, not reversed-shape]
Custom / Trimp Cap             cost=0       sheet_cost=0      mult=0       [REFUSE -- all-zero placeholder]
Gold / Trimp Cap               cost=0.0333  sheet_cost=5.00   mult=0       [REFUSE]
Green (Solid) / Trimp Cap      cost=0.0333  sheet_cost=5.00   mult=0       [REFUSE]
Hi Green / Trimp Cap           cost=0.0333  sheet_cost=5.00   mult=0       [REFUSE]
Hunter Green / Trimp Cap       cost=0.0366  sheet_cost=5.50   mult=0       [REFUSE]
Intense Blue / Trim Cap        cost=0.0333  sheet_cost=5.00   mult=0       [REFUSE]
Metallic Silver / Trimp Cap    cost=0.0333  sheet_cost=5.00   mult=0       [REFUSE]
Orange / Trimp Cap             cost=0.0400  sheet_cost=6.00   mult=0       [REFUSE]
Teal / Trimp Cap               cost=0.0333  sheet_cost=5.00   mult=0       [REFUSE]
Trim Cap - 1"                  cost=0.35    sheet_cost=null   mult=2.8571  [real multiplier, but malformed -- see below]
True Red / Trimp Cap           cost=0.0333  sheet_cost=5.00   mult=0       [REFUSE]
Yellow / Trimp Cap             cost=0.0333  sheet_cost=5.00   mult=0       [REFUSE]
```

### d. Is there an identity axis, or is the family just the product with colours as the variation?

**No single answer — splits cleanly by category, confirmed by the live dry run below, not just
asserted:**

- **Trim Cap** (30 rows): no axis at all. The family is the product itself
  (`Trim Cap`/`Trimp Cap`/`Trim Cap Jewelite`/`Trim Cap Gemini`), colour is the only variation —
  matches the framing exactly.
- **Return Coil** (19 rows): a real axis — bare-decimal gauge, `.040` (15 rows) or `.063`
  (4 rows), same shape as substrate's own `BARE_DECIMAL_THICKNESS_RE` (Aluminum Solid's gauge
  convention, `src/lib/material-family-proposals.ts:141`). This genuinely distinguishes SKUs —
  Mill and Black both appear at both gauges without merging in the dry run below, confirming the
  axis is real, not decorative.

### e. Every name that does NOT follow "`<colour> / <product>`"

**36 of 54.** Grouped by actual shape:

- **19 — `Coil .0XX <colour> <W>in x <L>ft`** (Return Coil).
- **11 — `Trim Cap <colour> <W>in <Brand>`** (Trim Cap, `Jewelite` ×10 / `Gemini` ×1).
- **2 — `Trim Cap Glue IPS Weld-On <size>`** (Trim Cap Glue).
- **2 — `SealTite Conduit`, `Spacers`** (Misc. Supplies).
- **1 — `Channel Letter Wall Buster Paige White 50Pk`** (Wall Pass Thru).
- **1 — `Trim Cap - 1"`** (Trim Cap, disabled, malformed).

18 (reversed) + 36 (not) = 54.

---

## The build

**`buildChannelLetterFamilyProposals`, a dedicated builder — not another `FamilyAxisConfig`
value.** Confirmed in the investigation (and re-confirmed here by the diff below): the generic
`buildFamilyProposals` pipeline structurally cannot parse this type — `FamilyAxisConfig` assumes
colour precedes axis (`material-family-proposals.ts:94–115`, `:340–342`), and its line-detection
(`computeLcpWordCount`, front-anchored longest-common-*prefix*) collapses to 0 words the moment
different rows start with different colour words, which is exactly what all 18 reversed-shape Trim
Cap rows do. Bolting two more optional hooks onto the shared interface for one structurally
different type was rejected in favor of a self-contained function with the exact same output shape
(`FamilyProposal[]`) and the exact same discipline (hard category partition, never drop a row, LOW
is always a singleton, `multiplier = 0` treated exactly like missing, category `<= 2` rows forced
LOW — that last rule reuses `buildFamilyProposals`' own existing rule at `:552`, not a new
invention for this type).

**Wiring** (`page.tsx`): one new branch — when the selected type is `Channel Letter Materials`,
call `buildChannelLetterFamilyProposals(newRows, categoryNames)` instead of
`buildFamilyProposals(newRows, categoryNames, config)`. Every other type's call is byte-for-byte
the same line it was before this branch existed.

**A real, live correction found during implementation, not the investigation**: `Trim Cap - 1"`
was reported as "no size available in text or stored data" in the investigation — that used a
size-token regex that only recognized the word `in`, not the bare quote-inch (`"`) convention. The
real build reuses the roll parser's own width regex (`ROLL_WIDTH_RE`, which already handles
quote-inch, from the earlier roll-length work), and it turns out `1"` **does** resolve to a width
of `1` via text. This row is still correctly forced LOW — no brand/colour distinguishes it from
the Jewelite family, and no length either — but the *reason* is now accurate (`size "1"" resolved
but no brand/product-line word distinguishes this row...`) rather than "no size at all." Flagged
here plainly rather than left as a silently-stale claim from the read-only pass.

**A second refinement, also found only by actually running the code against live data**: Return
Coil's DB `width`/`height` columns are confirmed swapped from the documented convention (finding
(d) in the investigation). The build does **not** silently swap them to fill in a family — it
normalizes width/height from the TEXT token for the 18 rows that have one (`<width>in x
<length>ft`, converting `ft` to inches for storage, matching roll's own convention), and for the
**one** row with no text length token (`Coil .063 Mill 3in`) it refuses to guess, forcing that row
LOW with an explicit "DB convention is reversed, no text token to resolve it" reason — rather than
folding it into `Coil .063` on an assumption. This moved `Coil .063` from 4 rows (investigation's
mirror script, which didn't implement this check) to 3 in the real build — a deliberate refinement,
not a discrepancy to be alarmed by.

---

## Dry-run grouping report — all 54 rows, run against the REAL exported function

Not a standalone mirror this time — this ran `buildChannelLetterFamilyProposals` exactly as
`page.tsx` will call it, against the live 54-row dataset, with an explicit row-accounting assertion
(`sourceRowIds total=54 unique=54 liveRows=54`) confirming no row was dropped or duplicated.

| | Families | Rows |
|---|---|---|
| High | 5 | 31 |
| Medium | 0 | 0 |
| Low | 23 | 23 |
| **Total** | **28** | **54** |

*(31 high-confidence rows, not the investigation's 32 — the one-row difference is the `Coil .063
Mill 3in` refinement above, correctly pulled into LOW instead of guessed into the `Coil .063`
family.)*

### The 5 high-confidence families

**`Coil` gauge=`.040`** (15 rows) — Black (2 sizes), Blue, Bright Brush Silver/White,
Bronze/White, Caution Yellow, Chevron Blue, Gold Mirror/White, Mill (3 sizes, including the
disabled 3.5in variant), Orange, Red, White (2 sizes). Width/height normalized from text on every
row (e.g. `Coil .040 Black 3.5in x 270ft` → width `3.5`, height `3240` — 270ft × 12).

**`Trim Cap` brand=`Jewelite`** (10 rows) — Black (2 sizes), Blue, Lime Green, Mustard, Orange,
Red (2 sizes, one with a stray trailing `-`), White (2 sizes). Width from text, height from DB
(length isn't in the name for this shape, confirmed in (d) of the investigation).

**`Coil` gauge=`.063`** (3 rows) — Black, Mill (2 sizes: 5in, 6in). `Coil .063 Mill 3in` is
deliberately **not** in this family — see the refinement above.

**`Trimp Cap`** (2 rows) — Black, Bronze. The only two reversed-shape rows with a real, non-zero
multiplier.

**`Trim Cap` brand=`Gemini`** (1 row) — Silver Metallic (8886). Cleanly parsed despite being alone;
kept separate from Jewelite per the investigation's cost-clustering finding (close but not
identical pricing).

### The 23 low-confidence singletons

**16 — `REFUSE: multiplier is 0`** (full list in (b) above).

**7 — other reasons:**

| Name | Reason |
|---|---|
| `Trim Cap - 1"` | size `1"` resolves but no brand/colour distinguishes it (see the correction above) |
| `Coil .063 Mill 3in` | DB width/height convention is reversed and no text length token resolves it — needs manual entry, not guessed |
| `Channel Letter Wall Buster Paige White 50Pk` | only 1 row in its category |
| `SealTite Conduit` | only 2 rows in its category, Misc. Supplies |
| `Spacers` | only 2 rows in its category, Misc. Supplies |
| `Trim Cap Glue IPS Weld-On 16 Pint` | only 2 rows in its category, Trim Cap Glue |
| `Trim Cap Glue IPS Weld-On 3 Quart` | only 2 rows in its category, Trim Cap Glue |

5 + 23 = 28 families, 31 + 23 = 54 rows — exact, confirmed by the function's own row-accounting
assertion, not hand-counted.

---

## Substrates and Roll Materials — byte-identical, confirmed two ways

1. **Diff-based (structural guarantee)**: `git diff origin/main -- src/lib/material-family-proposals.ts`
   is a single hunk, a pure insertion starting immediately after `ROLL_FAMILY_CONFIG`'s closing
   brace (`@@ -823,13 +823,385 @@`). **Zero lines above that point were touched** — every
   substrate/roll function (`SUBSTRATE_FAMILY_CONFIG`, `ROLL_FAMILY_CONFIG`, `buildFamilyProposals`,
   `parseRemainder`, `computeLcpWordCount`, `peelSubLineQualifiers`) is byte-identical to `main`.
2. **Live re-run (the real, unmodified `buildFamilyProposals`, both configs)**: both types now
   have **0 NEW rows** in production (fully migrated since the last check — Roll Materials moved
   from 126 remaining to 0 since the previous session). Re-ran against **all statuses** instead
   (the historical baseline's own methodology) to get a real, non-trivial number:
   - **Substrates, all 235 rows → 96 families (69 high / 4 medium / 23 low)** — exact match to
     every prior check, unchanged.
   - **Roll Materials, all 368 rows → 126 families (69 high / 27 medium / 30 low)** — no
     historical "all-status" baseline exists to compare this exact number against (prior checks
     were all NEW-only, at different points in the migration), but it's produced by the identical,
     untouched function — the diff proof above is the authoritative guarantee here, this is
     corroborating evidence, not the primary one.

## Verification run this session

- `npx tsc --noEmit` — clean.
- `npx eslint` on both touched files — clean.
- `npm run build` — succeeds, full production build.
- Live dry-run against the real `buildChannelLetterFamilyProposals` — 28 families / 54 rows, exact,
  row-accounting-asserted.
- Live substrate/roll regression check — see above.

## Files in this PR

- `src/lib/material-family-proposals.ts` — `CHANNEL_LETTER_TYPE_NAME`, `CHANNEL_LETTER_FAMILY_CONFIG`,
  `buildChannelLetterFamilyProposals`, registered in `FAMILY_CONFIGS`.
- `src/app/(dashboard)/dashboard/[slug]/settings/materials/migrate/page.tsx` — dispatches to the
  dedicated builder for this one type, unchanged for every other type.
- This report.

No migration. All scratch scripts that queried the database this session
(`scripts/_tmp_cl_verify_build.mjs`, `scripts/_tmp_verify_substrate_roll_baseline.mjs`,
`scripts/_tmp_verify_all_status.mjs`, plus the earlier investigation's
`scripts/_tmp_channel_letter_investigate.mjs` / `scripts/_tmp_channel_letter_dryrun.mjs` and their
JSON output) have been deleted.
