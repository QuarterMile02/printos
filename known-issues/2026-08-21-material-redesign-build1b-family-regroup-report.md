# 2026-08-21 — Material redesign Build 1b: family regroup report (2a/2b/2c)

## Status

Numbers approved by Ruben, UI built (item 2), parser generalized (item 3). A
second bug was found and fixed while generalizing — see below — which changed
the true family count from the originally-approved 102 to **96**. This report is
updated in place to state that corrected number throughout, once, rather than
leave a stale figure alongside the current one — see "Two bugs found and fixed"
for exactly what changed and why.

## "Colour / Finish" — the UI-facing label, everywhere

The real data includes Mill, Brite Brushed Gold, Dark Bronze Satin Anodized,
Painted 1 Side, Primed 2 Sided — finishes and prep states, not colours. The
grouping logic was already right; only the label was wrong. Every user-facing
string says "colour/finish" now (`migrate-client.tsx`'s UI labels, and every
`reasoning` string the parser produces — those render directly in the UI too).
The `material_colors` table name and internal field names (`colourName`,
`FamilyColourGroup`, etc.) are unchanged, per instruction.

## The UI (item 2)

`migrate-client.tsx` renders family name, its Colour / Finish list, and size
variants grouped under each — editable (edit or remove a colour/finish, edit or
remove a size within one) before accepting. `acceptSubstrateProposal` calls a new
Postgres function, `accept_family_proposal` (migration 182), so materials +
material_colors + material_variants + material_vendors + the shopvox_materials
migration links all land in **one real database transaction** — PostgREST has no
client-side multi-statement transaction API, so a single SQL function is the only
way to get true atomicity here: if anything fails (e.g. migration 181's
one-default-per-colour unique index firing), nothing lands, not a partial
material with no colours or an orphaned variant. `migrated_source_hash` is set to
`source_hash` as a same-row column reference evaluated live inside that same
`UPDATE`, inside the same transaction — read fresh at accept time, not threaded
in from the client request. LOW-confidence rows render exactly like any other
family (one colour/finish group, one size) with their `reasoning` string visible
in both the family list and the open proposal, so Ruben sees *why* the parser
declined to group, not just that it did.

## Parser generalized (item 3)

`src/lib/material-family-proposals.ts`: the identity axis ("Thickness" for
substrates) and the size extractor are now both parameters (`FamilyAxisConfig`),
not hardcoded. `SUBSTRATE_FAMILY_CONFIG` reproduces the exact validated substrate
behavior; a future roll/vinyl config plugs in without touching the grouping,
colour/code parsing, or any of the five confidence checks. What that config would
still need is listed at the bottom of this report and in the file itself —
deliberately not built yet.

## Two bugs found and fixed along the way

1. **Build 1's shared `SIZE_TOKEN_RE`** (`material-migrate-proposals.ts`): a
   thickness restated as "in x fraction" — e.g. `Aluminum 5ft x 10ft Mill .125in
   x 1/8in` — let the regex start matching mid-decimal (skipping the leading `.`
   of `.125in`) and produced a bogus match like `125in x 1`, which
   `stripSizeToken` then removed as if it were the sheet size, leaving the real
   size (`5ft x 10ft`) untouched. Fixed with `(?<![\d.])` before the first
   number. Re-verified this changes nothing about Build 1's own reported Finding
   A counts (235 total / 227 both-populated / 8 neither / 57 name-has-size —
   identical with the fix applied).

2. **A Build 1b regression**, found while generalizing: the rewritten parser had
   silently dropped Build 1's cut-to-length handling for the 8 Polycarbonate
   reel rows (no stored width/height, a bare trailing width like `52in` in the
   name instead of a WxH token). Without it, each reel row's trailing width
   leaked into the parsed Thickness value instead of being recognized as a size,
   so all 8 ended up as their own separate 1-row families — safe (nothing
   merged wrong), but 6 of those 8 (`Polycarbonate White .150in - 3/16"`, widths
   44/52/56/64/76/100) are genuinely one family, one colour/finish, six
   cut-to-length size variants, and should group as one. Fixed by teaching the
   substrate `extractSize` config to recognize and strip a cut-to-length width
   (Build 1's exact rule: only when the row has no stored width/height at all)
   before axis parsing ever sees the remaining text — matching Build 1's
   `extractCutToLengthWidth`/`length_increment` logic exactly.

## 1. Migration 181 — material_variants.color_id

`supabase/migrations/181_material_variants_color_id.sql` — proposed only, not run.
Four statements: the nullable FK column (`ON DELETE SET NULL`), an index, a
same-material validation trigger (color_id must belong to the variant's own
material — same discipline as the org_id/length_uom triggers already in 173), and
the one-default index redesign.

**One-default-per-material vs one-default-per-(material, colour/finish) — argued
both ways, recommendation implemented:**

- *Against changing it:* simpler — one flag, one row, "the" default regardless of
  which colour/finish is picked. Matches what Build 1 already shipped.
- *For changing it:* colour/finish is now a first-class concept this very
  redesign introduced ("a size belongs to a COLOUR, not just the material"). A
  single material-wide default becomes incoherent once a material has real
  colours/finishes with different typical stock sizes — if Ruben picks a specific
  one on a quote, the system needs a sensible default size for *that* group, not
  a fallback to whichever other group happened to hold the one material-wide flag.
- **Recommendation: switch to one-default-per-(material, colour/finish).** It
  matches the confirmed data model. Implemented as `CREATE UNIQUE INDEX ... ON
  material_variants(material_id, COALESCE(color_id, '00000000-...'::uuid)) WHERE
  is_default` — a plain `UNIQUE(material_id, color_id)` would NOT work here:
  Postgres treats `NULL` as distinct from every other `NULL` for uniqueness, so a
  colourless material (`color_id` NULL on every variant — the common case, see 2a
  below) could end up with many `is_default=true` rows simultaneously. The
  `COALESCE` to a fixed sentinel UUID collapses every NULL into one comparable
  group so the constraint actually holds for colourless materials too.

## 2a. How many families the new rule produces

**235 rows → 96 families** (was ~230 flat under Build 1's original size-only
grouping).

| | rows | families |
|---|---|---|
| HIGH confidence (auto-grouped, colour/finish+size structure) | 208 | 69 |
| MEDIUM confidence (auto-grouped, flagged for a second look) | 4 | 4 |
| LOW confidence (never grouped — own singleton family) | 23 | 23 |
| **Total** | **235** | **96** |

Every MEDIUM row (the 4 "ADA Alternative..." rows) ended up in its own 1-row
family, not grouped together — their thickness text differs on every single one
(`.03125in - 1/32" (Matte)` vs `w/Adh .03125in - 1/32" (Matte Non Glare)` vs `w/Adh
.0625in - 1/16" (Matte Non Glare)` vs `.0625in - 1/8"`), so the family key (which
includes thickness) never coincides between them even though they'd all be
flagged with the same "small category, uncertain line" reasoning. Worth noting:
this means MEDIUM here behaves identically to LOW in terms of actual grouping
outcome (no merging happened) — the only difference is these rows would still
show grouped under family key `(ADA, thickness)` if a future duplicate at the same
thickness showed up, whereas LOW rows are permanently keyed to their own row id
and can never merge with anything.

## 2b. The 10 largest families

| Rows | Line | Thickness | Colours/Finishes |
|---|---|---|---|
| 20 | Aluminum | .040 | 13: Black/White, Bright Clear Anodized Mirror Silver, Brite Brushed Gold, Brite Brushed Silver Clear, Bronze/White, Dark Bronze Satin Anodized, Gold Satin Anodized, Mill, Mirror Gold Bright Clear Anodized, Silver Satin Anodized, White, Brite Brushed Clear Silver, Brite Gold Mirror |
| 19 | Acrylic | .177in - 3/16" | 14: White (7328), Lime Green (47LG), Day/Nite (Gloss/ Matte), Milky White (2447), Red (2793), Black (2025), Blue (2050), Brown (2418), Burgundy (2240), Clear, Red (2157), Transparent Black (2064), Transparent Blue (2069), Transparent Lime Green (9093) |
| 17 | Acrylic | .220in - 1/4" | 13: Clear, Clear Silver Mirror (0001), White (7328), Black (2025), Blue (2050), Burgundy (2240), Clear Bottle Green (3030), Light Blue (2648), Light Grey (504), Non Glare Clear, Orange (2119), Red (2793), Transparent Black (2074) |
| 16 | Aluminum Composite | 3mm | 11: White/Black, White/White, Brushed Silver, White, Black/Black, Blue/Green, Brushed Gold, Magnetic White, Matte Black/White, Mirror Silver, Red/Yellow |
| 12 | Acrylic | .5in - 1/2" | 11: Clear, Black (2025), Blue (2050), Clear Bottle Green (3030), Green (2108), Ivory (2146), Orange (2119), Red (2157), Red (2793), White (7328), Yellow (2037) |
| 12 | Acrylic | .118in - 1/8" | 11: Black (2025), Bronze Mirror (1600), Burgundy (2240), Clear, Clear Silver Mirror (0001), Dark Bronze Mirror (2404), Light Blue (2329), Light Grey (504), Purple (2287), Transparent Lime Green (9093), White (7328) |
| 9 | Aluminum | .063 | 3: Black/White, Mill, White |
| 7 | Aluminum | .080 | 3: Mill, White, Black/White |
| 7 | Polycarbonate | .150in - 3/16" | 2: Clear (48in, cut-to-length), White (44in/52in/56in/64in/76in/100in, all cut-to-length) |
| 4 | MDO | .5in - 1/2" | 4: Painted 1 Side, Painted 2 Sided, Primed 1 Side, Primed 2 Sided |

All 10 are HIGH confidence. Example of sizes-within-a-colour/finish (the largest
family, `Aluminum .040`): "Black/White" carries sizes `4ft x 10ft`, `5ft x 10ft`,
and a no-token default (48×96-style); "White" the same three; most of the other
11 groups in that family have only the single default size.

## 2c. Every row the parser could not confidently split (23 LOW + 4 MEDIUM)

Unaffected by the cut-to-length fix — it only touched Polycarbonate, which was
never LOW or MEDIUM.

**LOW (23, each permanently its own singleton family, never grouped):**

| Name | Reason |
|---|---|
| Acrylic P95 Bottle Green (3030 Clear/ Matte) .220in - 1/4" | colour/finish starts with "P95" (digit) — grade/line code, not a colour/finish word |
| Acrylic P95 Bottle Green (3030 Clear/ Matte) .5in - 1/2" | same |
| Acrylic P95 Clear/ Matte .177in - 3/16" | same |
| Acrylic P95 Clear/ Matte .220in - 1/4" | same |
| Acrylic P95 Clear/ Matte .5in - 1/2" | same |
| Acrylic P95 Clear/ Matte 1in | same |
| ADA Acrylic Color Cast Blue (CC3X2-500M) Matte .118in - 1/8" | colour/finish starts with "Acrylic" — collides with the real "Acrylic" category name in this dataset |
| ADA Acrylic Color Cast Blue (CC3X2-500M) Matte .220in - 1/4" | same |
| ADA Acrylic Color Cast Silver (CC3X2-330M) Matte .118in - 1/8" | same |
| ADA Acrylic Color Cast Silver (CC3X2-330M) Matte .220in - 1/4" | same |
| Coroplast 10mm White | thickness ("10mm") appears before any colour/finish text — Coroplast puts thickness before colour/finish, opposite of every other product's order |
| Coroplast 4mm (COLOR) | literal unfinished ShopVOX placeholder, not a real colour/finish |
| Coroplast 4mm White | thickness-before-colour/finish order (see above) |
| Coroplast 4mm White 5ft x 10ft | same |
| Coroplast 4mm White- 18in x 24in | same |
| Coroplast 4mm White- Perfect Cut | same |
| Coroplast 4mm White- Political | same |
| Coroplast 6mm White | same |
| PETG Clear .020in | only 1 row in its category — not enough repetition to trust a split |
| Steel Corton 11 Guage - .1196in | only 2 rows in its category — same |
| Steel Corton 5ft x 10ft 11 Guage - .1196in | same |
| Ultra Board Black with .040 Brushed Silver .5in - 1/2 | only 2 rows in its category — same |
| Ultra Board Black with .040 Brushed Silver 1in | same |

**MEDIUM (4, grouped-but-flagged — in practice each ended up its own 1-row
family too, see 2a note above, but they're a different KIND of uncertain than
LOW: structurally parsed fine, just an unconfirmed line boundary):**

| Name | Reason |
|---|---|
| ADA Alternative Blue (3X1-501) .03125in - 1/32" (Matte) | category "ADA Signs" has a 2-word name but its rows only share 1 word ("ADA") of text; small category (8 rows) — plausible, not confirmed |
| ADA Alternative Blue (3X1-501) w/Adh .03125in - 1/32" (Matte Non Glare) | same |
| ADA Alternative Blue (3X1-501) w/Adh .0625in - 1/16" (Matte Non Glare) | same |
| ADA Alternative Brush Black & Gold w/Adh .0625in - 1/8" | same |

**Known residual limitation, flagged rather than silently accepted:** "Non Glare"
(Acrylic Non Glare Clear, in the .220in - 1/4" family's list above) is plausibly
its own sub-line the same way "P95" and "Digital" are, but has no structural
signal (no digit, no colliding category name) to catch it — it currently groups
as a normal colour/finish under plain "Acrylic". Worth a manual look; not fixed
here rather than guessed at.

## How the parser works (summary — full logic in `src/lib/material-family-proposals.ts`)

1. Strip the validated size token (Build 1's regex, bug-fixed as above), or —
   when the row has no stored width/height at all and a bare trailing width like
   `52in` is present instead — recognize it as a cut-to-length size (Build 1's
   exact rule) rather than letting it leak into the axis value.
2. **Line** = the longest word-for-word prefix shared by every row in the same
   `material_categories` row — computed from the data, not from the category's own
   label text (confirmed those routinely diverge, e.g. category "Corton Steel" vs
   name "Steel Corton...", word order reversed; category "Corrugated Plastic" vs
   name "Coroplast...", no shared words at all). `category_id` is also used as a
   hard partition: rows from different categories can never merge into the same
   family, regardless of what the text says.
3. **Colour/finish + code**: look for `Words (CODE)` first (the one unambiguous
   marker in this dataset — matches both Acrylic's ~60 numeric-coded colours and
   ADA's `(CC3X2-500M)`-style codes); otherwise take the text before the identity
   axis token as the colour/finish.
4. **Identity axis** (Thickness, for substrates): everything from the first
   `NN(in|mm)` / `NN Guage` / bare `.NNN` token onward, kept as an opaque string
   (exact-match grouping key, not further parsed — no risk from approximately
   matching two different values together). This axis, and the size extractor, are
   both parameters (`FamilyAxisConfig`), generalized per item 3.
5. Five independent confidence checks, each tied to a specific real row that broke
   an earlier, simpler version of this parser (full detail + the exact row in
   inline code comments): too-small-category swallowing the whole name, a literal
   `(COLOR)` placeholder, no axis token found, the axis appearing before any
   colour/finish text (Coroplast's reversed order), a colour/finish word colliding
   with another real category's name (ADA/Acrylic), and a colour/finish word
   carrying a digit (P95). Any one of these drops a row to LOW (never grouped) or
   MEDIUM (grouped, flagged).

## What a roll pass (kiss-cut / colour vinyl) would still need

Deliberately not built yet — only the shape is ready. Full detail in the code
comment at the bottom of `material-family-proposals.ts`; summary:

1. A `ROLL_FAMILY_CONFIG` with `axisLabel: 'Mil'` and a `findAxisStart` that
   matches vinyl's real mil convention — needs confirming against real vinyl
   material names first, same discipline this whole file follows.
2. A roll `extractSize` — width is closer to a colour/finish-level property for
   rolls (most vinyl colours only come in one or two standard widths), length is
   often open-ended/sold-by-the-foot. Likely reuses the same length_increment/
   cut-to-length mechanism Build 1 already built, not a new concept — but the
   exact shape needs confirming against real data.
3. Confirming vinyl's colour+code shape matches `Words (CODE)` as-is, or needs
   its own pattern.
4. The same "top 10 families + full LOW/MEDIUM list" report this file produced
   for substrates, run against real vinyl data, before building anything
   UI-facing for it.
