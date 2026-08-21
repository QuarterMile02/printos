# 2026-08-21 — Material redesign Build 1b: family regroup report (2a/2b/2c)

## Status

REPORT ONLY, per instruction ("REPORT BEFORE BUILDING THE UI — this is the gate...
STOP there. Do not touch the UI until I've seen those numbers"). Schema (migration
181, proposed only) and the rewritten grouping logic (`src/lib/material-
family-proposals.ts`) are built and verified against the live 235-row dataset —
verified twice: once as a validated standalone script against real data, once
again as the actual compiled TypeScript module, both producing identical numbers.
The migrate screen itself (`migrate-client.tsx`, `page.tsx`, `actions.ts`) is
**untouched** — still wired to Build 1's flat `buildSubstrateProposals`. Nothing
has been accepted on the migrate screen, so there is no accepted data to unwind.

## A pre-existing bug found and fixed along the way

While validating the new parser against real data, found a real bug in Build 1's
shared `SIZE_TOKEN_RE` (`src/lib/material-migrate-proposals.ts`): a thickness
restated as "in x fraction" — e.g. `Aluminum 5ft x 10ft Mill .125in x 1/8in` — let
the regex start matching mid-decimal (skipping the leading `.` of `.125in`) and
produced a bogus match like `125in x 1`, which `stripSizeToken` then removed as if
it were the sheet size, leaving the real size (`5ft x 10ft`) untouched. Fixed with
`(?<![\d.])` before the first number. **Re-verified this changes nothing about
Build 1's own reported Finding A counts** (235 total / 227 both-populated / 8
neither / 57 name-has-size — identical with the fix applied); it only stops a
handful of Aluminum rows from being mis-parsed.

## 1. Migration 181 — material_variants.color_id

`supabase/migrations/181_material_variants_color_id.sql` — proposed only, not run.
Four statements: the nullable FK column (`ON DELETE SET NULL`), an index, a
same-material validation trigger (color_id must belong to the variant's own
material — same discipline as the org_id/length_uom triggers already in 173), and
the one-default index redesign.

**One-default-per-material vs one-default-per-(material, colour) — argued both
ways, recommendation implemented:**

- *Against changing it:* simpler — one flag, one row, "the" default regardless of
  which colour is picked. Matches what Build 1 already shipped.
- *For changing it:* colour is now a first-class concept this very redesign
  introduced ("a size belongs to a COLOUR, not just the material"). A single
  material-wide default becomes incoherent once a material has real colours with
  different typical stock sizes — if Ruben picks a specific colour on a quote, the
  system needs a sensible default size for *that colour*, not a fallback to
  whichever other colour happened to hold the one material-wide flag.
- **Recommendation: switch to one-default-per-(material, colour).** It matches the
  confirmed data model. Implemented as `CREATE UNIQUE INDEX ... ON
  material_variants(material_id, COALESCE(color_id, '00000000-...'::uuid)) WHERE
  is_default` — a plain `UNIQUE(material_id, color_id)` would NOT work here:
  Postgres treats `NULL` as distinct from every other `NULL` for uniqueness, so a
  colourless material (`color_id` NULL on every variant — the common case, see 2a
  below) could end up with many `is_default=true` rows simultaneously. The
  `COALESCE` to a fixed sentinel UUID collapses every NULL into one comparable
  group so the constraint actually holds for colourless materials too.

## 2a. How many families the new rule produces

**235 rows → 102 families** (was ~230 flat under Build 1's original size-only
grouping).

| | rows | families |
|---|---|---|
| HIGH confidence (auto-grouped, colour+size structure) | 208 | 75 |
| MEDIUM confidence (auto-grouped, flagged for a second look) | 4 | 4 |
| LOW confidence (never grouped — own singleton family) | 23 | 23 |
| **Total** | **235** | **102** |

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

| Rows | Line | Thickness | # Colours | Confidence |
|---|---|---|---|---|
| 20 | Aluminum | .040 | 13: Black/White, Bright Clear Anodized Mirror Silver, Brite Brushed Gold, Brite Brushed Silver Clear, Bronze/White, Dark Bronze Satin Anodized, Gold Satin Anodized, Mill, Mirror Gold Bright Clear Anodized, Silver Satin Anodized, White, Brite Brushed Clear Silver, Brite Gold Mirror | high |
| 19 | Acrylic | .177in - 3/16" | 14: White (7328), Lime Green (47LG), Day/Nite (Gloss/ Matte), Milky White (2447), Red (2793), Black (2025), Blue (2050), Brown (2418), Burgundy (2240), Clear, Red (2157), Transparent Black (2064), Transparent Blue (2069), Transparent Lime Green (9093) | high |
| 17 | Acrylic | .220in - 1/4" | 13: Clear, Clear Silver Mirror (0001), White (7328), Black (2025), Blue (2050), Burgundy (2240), Clear Bottle Green (3030), Light Blue (2648), Light Grey (504), Non Glare Clear, Orange (2119), Red (2793), Transparent Black (2074) | high |
| 16 | Aluminum Composite | 3mm | 11: White/Black, White/White, Brushed Silver, White, Black/Black, Blue/Green, Brushed Gold, Magnetic White, Matte Black/White, Mirror Silver, Red/Yellow | high |
| 12 | Acrylic | .5in - 1/2" | 11: Clear, Black (2025), Blue (2050), Clear Bottle Green (3030), Green (2108), Ivory (2146), Orange (2119), Red (2157), Red (2793), White (7328), Yellow (2037) | high |
| 12 | Acrylic | .118in - 1/8" | 11: Black (2025), Bronze Mirror (1600), Burgundy (2240), Clear, Clear Silver Mirror (0001), Dark Bronze Mirror (2404), Light Blue (2329), Light Grey (504), Purple (2287), Transparent Lime Green (9093), White (7328) | high |
| 9 | Aluminum | .063 | 3: Black/White, Mill, White | high |
| 7 | Aluminum | .080 | 3: Mill, White, Black/White | high |
| 4 | MDO | .5in - 1/2" | 4: Painted 1 Side, Painted 2 Sided, Primed 1 Side, Primed 2 Sided | high |
| 3 | Aluminum | .125in - 1/8in | 1: Mill | high |

Example of sizes-within-a-colour (the largest family, `Aluminum .040`): colour
"Black/White" carries sizes `4ft x 10ft`, `5ft x 10ft`, and a no-token default
(48×96-style); colour "White" the same three; most of the other 11 colours in
that family have only the single default size.

## 2c. Every row the parser could not confidently split (23 LOW + 4 MEDIUM)

**LOW (23, each permanently its own singleton family, never grouped):**

| Name | Reason |
|---|---|
| Acrylic P95 Bottle Green (3030 Clear/ Matte) .220in - 1/4" | colour starts with "P95" (digit) — grade/line code, not a colour word |
| Acrylic P95 Bottle Green (3030 Clear/ Matte) .5in - 1/2" | same |
| Acrylic P95 Clear/ Matte .177in - 3/16" | same |
| Acrylic P95 Clear/ Matte .220in - 1/4" | same |
| Acrylic P95 Clear/ Matte .5in - 1/2" | same |
| Acrylic P95 Clear/ Matte 1in | same |
| ADA Acrylic Color Cast Blue (CC3X2-500M) Matte .118in - 1/8" | colour starts with "Acrylic" — collides with the real "Acrylic" category name in this dataset |
| ADA Acrylic Color Cast Blue (CC3X2-500M) Matte .220in - 1/4" | same |
| ADA Acrylic Color Cast Silver (CC3X2-330M) Matte .118in - 1/8" | same |
| ADA Acrylic Color Cast Silver (CC3X2-330M) Matte .220in - 1/4" | same |
| Coroplast 10mm White | thickness ("10mm") appears before any colour text — Coroplast puts thickness before colour, opposite of every other product's order |
| Coroplast 4mm (COLOR) | literal unfinished ShopVOX placeholder, not a real colour |
| Coroplast 4mm White | thickness-before-colour order (see above) |
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
(Acrylic Non Glare Clear, in the .220in - 1/4" family's colour list above) is
plausibly its own sub-line the same way "P95" and "Digital" are, but has no
structural signal (no digit, no colliding category name) to catch it — it
currently groups as a normal colour under plain "Acrylic". Worth a manual look;
not fixed here rather than guessed at.

## How the parser works (summary — full logic in `src/lib/material-family-proposals.ts`)

1. Strip the validated size token (Build 1's regex, bug-fixed as above).
2. **Line** = the longest word-for-word prefix shared by every row in the same
   `material_categories` row — computed from the data, not from the category's own
   label text (confirmed those routinely diverge, e.g. category "Corton Steel" vs
   name "Steel Corton...", word order reversed; category "Corrugated Plastic" vs
   name "Coroplast...", no shared words at all). `category_id` is also used as a
   hard partition: rows from different categories can never merge into the same
   family, regardless of what the text says.
3. **Colour + code**: look for `ColourWords (CODE)` first (the one unambiguous
   marker in this dataset — matches both Acrylic's ~60 numeric-coded colours and
   ADA's `(CC3X2-500M)`-style codes); otherwise take the text before the first
   thickness token as the colour.
4. **Thickness**: everything from the first `NN(in|mm)` / `NN Guage` / bare
   `.NNN` token onward, kept as an opaque string (exact-match grouping key, not
   further parsed — no risk from approximately matching two different thicknesses
   together).
5. Five independent confidence checks, each tied to a specific real row that broke
   an earlier, simpler version of this parser (full detail + the exact row in
   inline code comments): too-small-category swallowing the whole name, a literal
   `(COLOR)` placeholder, no thickness token found, thickness appearing before any
   colour text (Coroplast's reversed order), a colour word colliding with another
   real category's name (ADA/Acrylic), and a colour word carrying a digit (P95).
   Any one of these drops a row to LOW (never grouped) or MEDIUM (grouped,
   flagged).

## Next step

Waiting for approval of these numbers before touching `migrate-client.tsx`,
`page.tsx`, or `actions.ts` (item 4 — colour-aware proposal UI, editable colour/
size lists, `acceptSubstrateProposal` creating `material_colors` rows and setting
`material_variants.color_id`).
