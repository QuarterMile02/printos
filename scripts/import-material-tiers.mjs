// RETIRED 2026-08-21 (material redesign Build 1, item 10).
//
// This used to write directly to material_pricing_tiers and
// material_vendors, matched to public.materials by exact case-
// insensitive name, delete-then-insert per material. That write path is
// gone: scripts/scrape-shopvox-material-tiers.js now stages every
// scraped material (base fields + vendor pricing + pricing tiers,
// keyed by ShopVOX's own material uuid, not a name match) into the new
// public.shopvox_materials table directly, as part of the same
// per-material page visit — this separate second-pass importer is no
// longer part of the pipeline at all.
//
// Rationale (from the instruction that drove this): Ruben hand-enters
// shipping cost, min/max qty, shelf life, and delivery terms with no
// ShopVOX source — an in-place write here would silently destroy that,
// unrecoverably, on every re-run. And once substrate families exist
// ("... NLC" instead of "... NLC 38in"), exact-name matching stops
// matching and this script's insert path would create duplicate rows
// instead of recognizing an existing material.
//
// Refusing to run rather than silently doing nothing, so a stale cron
// job or muscle-memory `node scripts/import-material-tiers.mjs` doesn't
// go quiet and get assumed-working — it fails loudly instead.
//
// Replacement: run scripts/scrape-shopvox-material-tiers.js directly —
// it stages into shopvox_materials on its own, no second import step.
// Real materials/material_vendors/material_pricing_tiers rows are then
// created only by accepting a proposal on the migrate screen.

console.error('\n✗ scripts/import-material-tiers.mjs is retired — it used to write directly to material_vendors/material_pricing_tiers, which is no longer allowed (material redesign Build 1, item 10). Run scripts/scrape-shopvox-material-tiers.js instead; it stages into shopvox_materials on its own. See this file\'s header comment for the full rationale.')
process.exit(1)
