// Text-block parsers for the free-text sections the capture script preserved
// verbatim (History, Proofs, Workflow, BOM). These sections were captured as
// prose (innerText of a container), not structured JSON, because the live
// DOM doesn't expose them any other way (see scripts/chain-capture/_findings.md).
// Parsing them is inherently best-effort — every function here documents its
// known failure modes, and the raw text/html is ALWAYS also stored on the
// corresponding row's `raw` jsonb column so nothing is lost if a parse is wrong.
import { parseDateTimeMDY, extractUuid, parseAmountUom, parseMoney } from './shopvox-import-parse.mjs'

const DATE_LINE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s*(AM|PM)$/i

// Parses a "History" tab's full text (job.history.text or
// transaction.tabs.history.historyFullText) into discrete activity entries.
// CONFIRMED LIVE shape (scripts/chain-capture/chainA/JB_14597.json):
//   [Initials]
//   [Actor full name]
//   [action phrase, 1+ lines, sometimes ending in a literal "on" line]
//   [MM/DD/YYYY HH:MM:SS AM/PM]
//   [optional "Field Name: Old → New"]
// repeating with NO blank-line separators between entries. Returns [] if the
// "Last activity" anchor isn't found (e.g. a transaction with zero history).
export function parseActivities(text) {
  if (!text) return []
  const allLines = text.split('\n').map((l) => l.trim())
  const anchorIdx = allLines.findIndex((l) => /^Last activity/i.test(l))
  if (anchorIdx === -1) return []
  const lines = allLines.slice(anchorIdx + 1).filter((l) => l !== '')

  const entries = []
  let i = 0
  let sequence = 0
  while (i < lines.length) {
    const initials = lines[i]
    // Sanity gate: a real entry always starts with a short initials/team-code
    // token. If this fails, the text after the anchor didn't match the
    // expected shape — stop rather than emit garbage.
    if (!/^[A-Za-z0-9]{1,6}$/.test(initials)) break
    i++
    if (i >= lines.length) break
    const actor = lines[i]
    i++
    const descLines = []
    while (i < lines.length && !DATE_LINE_RE.test(lines[i])) {
      descLines.push(lines[i])
      i++
    }
    if (i >= lines.length) break // ran off the end without finding a date — malformed tail, stop
    const occurredAt = parseDateTimeMDY(lines[i])
    i++
    const actionText = descLines.filter((l) => l !== 'on').join(' ').replace(/\s+on$/, '').trim()
    let fieldName = null, oldValue = null, newValue = null
    if (i < lines.length && lines[i].includes('→') && !/^[A-Za-z0-9]{1,6}$/.test(lines[i])) {
      const fieldLine = lines[i]
      const colonIdx = fieldLine.indexOf(':')
      if (colonIdx > -1) {
        fieldName = fieldLine.slice(0, colonIdx).trim()
        const rest = fieldLine.slice(colonIdx + 1)
        const [ov, nv] = rest.split('→').map((s) => s.trim())
        oldValue = ov || null
        newValue = nv || null
      }
      i++
    }
    entries.push({ actor, actionText, occurredAt, fieldName, oldValue, newValue, sequence })
    sequence++
  }
  return entries
}

// Parses job.proofsBlock.{text,html} into one row per proof VERSION.
// CONFIRMED LIVE (JB_14597): filename ("proof.JPG"), an upload timestamp,
// a "Version N" button, view count, comment count, approval status, a
// thumbnail <img src> and a full-res <a href>. Only ONE version was ever
// observed live in this pilot (see _findings.md) — the multi-version case
// (spec: "Expand the version chevron and capture EVERY version") is
// UNEXERCISED. This parser extracts exactly the single visible card; if a
// job ever has >1 version, whichever version is currently displayed is what
// gets captured, and this is a known gap (see the unmapped-fields report).
export function parseProofs(proofsBlock) {
  if (!proofsBlock || !proofsBlock.html) return []
  const html = proofsBlock.html
  const filenameM = html.match(/class="css-b4xa2l">([^<]+)<\/p>/)
  const uploadedAtM = html.match(/text-grey600 css-i7pnfr">(\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2} (?:AM|PM))<\/p>/)
  const versionM = html.match(/css-19l73x5">Version (\d+)</)
  const thumbM = html.match(/<img[^>]+src="([^"]+)"/)
  const downloadM = html.match(/<a href="([^"]+)"[^>]*target="_blank"[^>]*rel="noopener noreferrer">/)
  const countsM = [...html.matchAll(/css-ifbqr7">(\d+|Approved|Disapproved|In Review|No Reaction)<\/p>/g)].map((m) => m[1])
  // countsM[0] = view count, countsM[1] = comment count; approval status is
  // rendered differently (nested in a colored div, not this <p> pattern) —
  // pull it from the dedicated green/red status span instead.
  const approvalM = html.match(/text-(green|red)600">[\s\S]{0,1500}?css-ifbqr7">([A-Za-z ]+)<\/p>/)
  const filename = filenameM ? filenameM[1] : null
  const extM = filename ? filename.match(/\.([A-Za-z0-9]+)$/) : null
  const ext = extM ? extM[1].toLowerCase() : null
  const contentTypeByExt = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', pdf: 'application/pdf', ai: 'application/postscript', eps: 'application/postscript', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff' }
  return [{
    filename,
    version: versionM ? parseInt(versionM[1], 10) : 1,
    uploadedAt: uploadedAtM ? parseDateTimeMDY(uploadedAtM[1]) : null,
    approvalStatus: approvalM ? approvalM[2] : null,
    viewCount: countsM[0] != null ? parseInt(countsM[0], 10) : null,
    commentCount: countsM[1] != null ? parseInt(countsM[1], 10) : null,
    thumbnailUrl: thumbM ? thumbM[1] : null,
    downloadUrl: downloadM ? downloadM[1] : null,
    contentType: ext ? contentTypeByExt[ext] || null : null,
  }]
}

// Fixed, confirmed-live phase taxonomy (identical across all 3 workflow
// templates captured — "Digital Print", "Pick & Buy", "Service Call" — even
// when a given phase has zero steps for that template). See _findings.md
// item "workflow template is chosen per job, not fixed" — the STEP set
// varies, the PHASE set does not, in this sample.
const PHASE_NAMES = ['Pre-Production', 'Production', 'Commercial Production', 'Fabrication', 'Post-Production']

// Parses job.workflow.text into step rows.
// KNOWN LIMITATION (flagged prominently — do not trust stage attribution
// blindly): the capture script never force-expands collapsed phase groups.
// When a phase is expanded, its steps render immediately after its name
// (confirmed unambiguous for chain A's "Digital Print" job). When ALL
// phases render collapsed (observed for both chain B jobs), the DOM's
// flattened text still lists all 5 phase names first, THEN every step name
// with no structural boundary at all — so this parser CANNOT tell which
// phase a step belongs to in that case. It falls back to assigning the
// LAST phase name seen before the step (a naive nearest-preceding-header
// heuristic), which is a guess, not a fact. Every row's `raw` column
// carries a `stageAttributionConfident` flag so this can be filtered later.
export function parseWorkflowSteps(workflowBlock) {
  if (!workflowBlock || !workflowBlock.text) return []
  const lines = workflowBlock.text.split('\n').map((l) => l.trim()).filter(Boolean)
  // First line is "Workflow - <template name>" — skip it.
  const body = lines.slice(1)

  // Detect the "all phases rendered collapsed" case: every PHASE_NAMES
  // entry appears back-to-back with no step line between any consecutive
  // pair (confirmed live on both chain B jobs — see doc comment above). In
  // that case nearest-preceding attribution would silently pin every step
  // to "Post-Production" (the last phase in the fixed list), which is a
  // guess dressed up as data — refuse to attribute at all instead.
  const phaseIdx = []
  body.forEach((l, idx) => { if (PHASE_NAMES.includes(l)) phaseIdx.push(idx) })
  const allPhasesContiguous = phaseIdx.length >= PHASE_NAMES.length &&
    phaseIdx.slice(0, PHASE_NAMES.length).every((idx, k) => k === 0 || idx === phaseIdx[k - 1] + 1)

  // A step line is followed by an optional badge-count line (digits/letters
  // like "48S" or "1S") and then an assignee-count line (bare digits).
  // Confirmed shape: "Design\n\n1" (name, then assignee count) or
  // "Customer Review\n\n48S\n1" (name, a duration/state badge, assignee count).
  const steps = []
  let currentPhase = null
  let position = 0
  let i = 0
  while (i < body.length) {
    const line = body[i]
    if (PHASE_NAMES.includes(line)) { currentPhase = line; i++; continue }
    // A step name line: NOT a phase name, and not itself a bare-count token.
    if (/^\d+[A-Za-z]?$/.test(line)) { i++; continue } // stray count with no preceding name (shouldn't happen, guard anyway)
    const stepName = line
    i++
    let assigneeCount = null
    let badge = null
    // Look ahead up to 2 lines for count tokens before the next phase/step name.
    for (let look = 0; look < 2 && i < body.length; look++) {
      if (PHASE_NAMES.includes(body[i])) break
      const tok = body[i]
      if (/^\d+$/.test(tok)) { assigneeCount = parseInt(tok, 10); i++; break }
      if (/^\d+[A-Za-z]+$/.test(tok)) { badge = tok; i++; continue }
      break
    }
    position++
    steps.push({
      stage: allPhasesContiguous ? null : currentPhase,
      stageAttributionConfident: !allPhasesContiguous && currentPhase != null,
      stepName,
      position,
      assigneeCount,
      badge,
    })
  }
  return steps
}

// Parses job.bom.html for the "TXN:LI / Type / Name / Est Qty / Act Qty /
// Difference / Est Cost / Act Cost / Attr 1 / Attr 2" materials grid
// (CONFIRMED LIVE on JB_14597 — a real shopvox custom grid,
// class="_wrapper_12otk_1", nested inside the BOM section). Both chain B
// jobs showed a literal "No records." row instead of this grid (confirmed:
// service/pick-and-buy jobs carry no BOM inventory) — returns [] for those.
export function parseBomGridRows(bomBlock) {
  if (!bomBlock || !bomBlock.html || !bomBlock.html.includes('_wrapper_12otk_')) return []
  const html = bomBlock.html
  // Header cells (no `header=` attribute — that attribute only appears on
  // BODY cells in this grid) live before _contentWrapper_12otk_183; body
  // cells live after. Splitting there gives a reliable header COUNT even
  // when there's only 1 body row (which would otherwise be indistinguishable
  // from "the header row repeating" — confirmed live bug, fixed here).
  const splitIdx = html.indexOf('_contentWrapper_12otk_183')
  const headerHtml = splitIdx >= 0 ? html.slice(0, splitIdx) : html
  const bodyHtml = splitIdx >= 0 ? html.slice(splitIdx) : ''
  const headerNames = [...headerHtml.matchAll(/_flex_12otk_82" style="align-items: center; padding: 0px;[^"]*">([^<]+)<\/div>/g)].map((m) => m[1])

  const cellRe = /header="([^"]+)"[^>]*>([\s\S]*?)<div class="_cellFade_12otk_114">/g
  const bodyCells = []
  let m
  while ((m = cellRe.exec(bodyHtml))) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    bodyCells.push({ header: m[1], text })
  }
  const rows = []
  const width = headerNames.length || 1
  for (let i = 0; i < bodyCells.length; i += width) {
    const rowCells = bodyCells.slice(i, i + width)
    if (rowCells.length < width) break // partial trailing row — malformed, drop
    const obj = {}
    rowCells.forEach((c) => { obj[c.header] = c.text })
    rows.push(obj)
  }
  return rows.map((r, idx) => {
    const est = parseAmountUom(r['Est Qty'])
    return {
      position: idx + 1,
      txnLi: r['TXN:LI'] || null,
      materialType: r['Type'] || null,
      materialName: r['Name'] || null,
      quantity: est.amount,
      uom: est.uom,
      estCost: parseMoney(r['Est Cost']),
      actCost: parseMoney(r['Act Cost']),
      raw: r,
    }
  })
}
