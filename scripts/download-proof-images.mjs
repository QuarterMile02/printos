/**
 * download-proof-images.mjs
 *
 * Standalone proof-image downloader. Independent of shopvox-capture.mjs by
 * design — confirmed live (2026-08-24) that assets.shopvox.com proof URLs
 * return 200 on a plain unauthenticated GET (no cookies, no session, no
 * browser). This script never touches scripts/queue/, never launches a
 * browser, never reads or writes the capture process's lock file — it is
 * safe to run concurrently with a live shopvox-capture.mjs run.
 *
 * Reads shopvox_proofs rows with storage_path IS NULL (org-wide, not
 * customer-scoped), downloads each download_url, writes the file to
 * scripts/capture/proofs/proof_<shopvox_id>.<ext> (parallel to the existing
 * scripts/capture/pdfs/ convention shopvox_documents uses), then updates
 * that row's storage_path/content_type/file_size_bytes.
 *
 * Resumable by construction: storage_path IS NULL is both the work queue
 * and the checkpoint. Each row is updated immediately after its own
 * download succeeds — a stop mid-run (Ctrl+C, crash, power loss) leaves
 * completed rows already marked done and the rest still null. Re-running
 * just re-queries the same filter and continues; no separate progress file
 * to corrupt or resume from.
 *
 * BUG FOUND AND FIXED (2026-08-27, Task AS) — the eighth instance of this
 * project's "a step reported success while doing nothing" pattern.
 * REPRODUCED, not guessed: an earlier version of this script's DB-update
 * payload included a `sha256` field. `shopvox_proofs` has no such column
 * (confirmed live: `PGRST204 — Could not find the 'sha256' column of
 * 'shopvox_proofs' in the schema cache`), so PostgREST rejected the WHOLE
 * update, every single time, for every one of the 2,083 rows this ever ran
 * against — while the file download+write half (a separate step, no DB
 * involved) succeeded every time. Net effect: all 2,083 files landed on
 * disk correctly, but `storage_path` stayed NULL on all 2,083 rows,
 * indefinitely, with zero error surfaced anywhere a human would see it. A
 * later edit removed `sha256` from the payload (see the comment at the
 * update call below) — CORRECT, confirmed by reproducing the exact
 * PGRST204 error live and confirming the current payload no longer sends
 * that field — but nobody had re-run the script since, so the 2,083
 * already-downloaded files stayed unrecorded until this fix.
 *
 * FIX: this script now checks OUT_DIR for an existing `proof_<shopvox_id>.*`
 * file BEFORE ever touching the network. If found, it backfills
 * storage_path/content_type/file_size_bytes straight from that file on
 * disk — zero bytes re-fetched from ShopVOX. Only a genuinely new proof
 * (nothing on disk yet) falls through to an actual download. This is what
 * let the 2,083-row backfill run with 0 network calls to ShopVOX.
 *
 * STANDING NOTE: `storage_path IS NULL` is the work-queue/checkpoint
 * signal this script (and any future one) relies on to mean "not yet
 * downloaded." That signal LIED for every row from whenever the pre-fix
 * version ran until the 2026-08-27 backfill closed the gap — a `storage_path
 * IS NULL` count is only trustworthy again as of that backfill. If this
 * script's DB-write step is ever changed again, verify the change with an
 * INDEPENDENT re-read afterward (this file's own `.select('id')` +
 * zero-rows-matched check already does this per-row; the same discipline
 * applies to any future edit here) — don't trust that "no error was thrown"
 * means the row was actually written.
 *
 * Usage:
 *   node scripts/download-proof-images.mjs --dry-run
 *   node scripts/download-proof-images.mjs --apply
 *
 * --dry-run is the default (HEAD-checks every candidate URL not already on
 * disk — status, content-length, no bytes saved, no DB write; a candidate
 * already on disk is reported as a pending backfill instead of HEAD-checked,
 * since backfilling never touches the network). --apply required to
 * actually write (backfill from disk, or download+write for anything new).
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAllRows } from './lib/supabase-paginate.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const ORG = '4ca12dff-97be-4472-8099-ab102a3af01a'
const OUT_DIR = join(root, 'scripts', 'capture', 'proofs')
const LOCK_PATH = join(OUT_DIR, '.lock')
const RATE_LIMIT_MS = 500 // ~2 req/sec, matching the capture pipeline's own courtesy rate

const APPLY = process.argv.includes('--apply')
const DRY_RUN = !APPLY
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.slice('--limit='.length), 10) : null

function loadEnv() {
  const env = readFileSync(join(root, '.env.local'), 'utf8')
  return Object.fromEntries(env.split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
}
const vars = loadEnv()
const sb = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY)

function isPidAlive(pid) { try { process.kill(pid, 0); return true } catch (e) { return e.code !== 'ESRCH' } }
function acquireLock() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  if (existsSync(LOCK_PATH)) {
    let existing
    try { existing = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) } catch { existing = null }
    if (existing && isPidAlive(existing.pid)) {
      console.error(`FATAL: another download-proof-images.mjs is already running (pid ${existing.pid}, started ${existing.startedAt}). Refusing to start a second writer.`)
      process.exit(1)
    }
    try { unlinkSync(LOCK_PATH) } catch {}
  }
  writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2))
  process.on('exit', () => { try { unlinkSync(LOCK_PATH) } catch {} })
}

function extFromContentType(ct) {
  if (!ct) return 'bin'
  if (ct.includes('jpeg')) return 'jpg'
  if (ct.includes('png')) return 'png'
  if (ct.includes('gif')) return 'gif'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('pdf')) return 'pdf'
  return 'bin'
}

function contentTypeFromExt(ext) {
  const e = ext.toLowerCase()
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg'
  if (e === '.png') return 'image/png'
  if (e === '.gif') return 'image/gif'
  if (e === '.webp') return 'image/webp'
  if (e === '.pdf') return 'application/pdf'
  return 'application/octet-stream'
}

// Task AS (2026-08-27): map of every proof_<shopvox_id>.<ext> file already
// on disk, built once at start. Existing candidates are backfilled straight
// from this — no network call, no re-download — which is how the 2,083-row
// backfill ran without touching ShopVOX at all. Only a shopvox_id with no
// entry here falls through to an actual download below.
function buildExistingFileMap() {
  const map = new Map()
  if (!existsSync(OUT_DIR)) return map
  for (const fileName of readdirSync(OUT_DIR)) {
    const m = fileName.match(/^proof_([0-9a-fA-F-]{36})\.[A-Za-z0-9]+$/)
    if (m) map.set(m[1], fileName)
  }
  return map
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (HEAD-check only, no download, no DB write)' : 'APPLY (downloading + writing)'}`)
  if (!DRY_RUN) acquireLock()

  let rows = await fetchAllRows(sb, 'shopvox_proofs', (q) =>
    q.select('id,shopvox_id,filename,download_url,content_type').eq('organization_id', ORG).is('storage_path', null))
  console.log(`Candidates (storage_path IS NULL): ${rows.length}`)
  if (LIMIT) { rows = rows.slice(0, LIMIT); console.log(`--limit=${LIMIT}: processing only the first ${rows.length}`) }

  const existingFiles = buildExistingFileMap()
  console.log(`Files already on disk in ${OUT_DIR}: ${existingFiles.size}`)

  let ok = 0, backfilled = 0, notFound = 0, authRequired = 0, otherError = 0, totalBytes = 0
  const problems = []

  for (const row of rows) {
    const existingFileName = existingFiles.get(row.shopvox_id)

    if (existingFileName) {
      // Already downloaded in a prior run — backfill from disk, no network.
      const filePath = join(OUT_DIR, existingFileName)
      if (DRY_RUN) {
        const size = statSync(filePath).size
        backfilled++
        totalBytes += size
        continue
      }
      try {
        const size = statSync(filePath).size
        const contentType = row.content_type || contentTypeFromExt(extname(existingFileName))
        const { data: updData, error: updErr } = await sb.from('shopvox_proofs').update({
          storage_path: filePath,
          content_type: contentType,
          file_size_bytes: size,
        }).eq('id', row.id).select('id')
        if (updErr) {
          otherError++
          problems.push({ id: row.shopvox_id, issue: `DB update failed (backfill): ${updErr.message}` })
          console.error(`  [${row.shopvox_id}] DB update ERROR (backfill): ${updErr.message}`)
        } else if (!updData || updData.length === 0) {
          otherError++
          problems.push({ id: row.shopvox_id, issue: 'DB update matched 0 rows (backfill) — no error, but nothing written' })
          console.error(`  [${row.shopvox_id}] DB update matched 0 rows (backfill) — row not recorded`)
        } else {
          backfilled++
          totalBytes += size
          if (backfilled % 200 === 0 || backfilled <= 5) console.log(`  [backfill ${backfilled}] ${existingFileName} (${(size / 1024).toFixed(0)} KB)`)
        }
      } catch (e) {
        otherError++
        problems.push({ id: row.shopvox_id, issue: `backfill failed: ${e.message}` })
      }
      continue // never falls through to a network download once a disk file was found
    }

    if (!row.download_url) { otherError++; problems.push({ id: row.shopvox_id, issue: 'no download_url in staging' }); continue }
    try {
      if (DRY_RUN) {
        const res = await fetch(row.download_url, { method: 'HEAD', signal: AbortSignal.timeout(15000) })
        if (res.status === 404) { notFound++; problems.push({ id: row.shopvox_id, url: row.download_url, status: 404 }) }
        else if (res.status === 401 || res.status === 403) { authRequired++; problems.push({ id: row.shopvox_id, url: row.download_url, status: res.status }) }
        else if (res.status !== 200) { otherError++; problems.push({ id: row.shopvox_id, url: row.download_url, status: res.status }) }
        else {
          ok++
          const len = parseInt(res.headers.get('content-length') || '0', 10)
          totalBytes += len
        }
      } else {
        const res = await fetch(row.download_url, { method: 'GET', signal: AbortSignal.timeout(30000) })
        if (res.status === 404) { notFound++; problems.push({ id: row.shopvox_id, url: row.download_url, status: 404 }); await sleep(RATE_LIMIT_MS); continue }
        if (res.status === 401 || res.status === 403) { authRequired++; problems.push({ id: row.shopvox_id, url: row.download_url, status: res.status }); await sleep(RATE_LIMIT_MS); continue }
        if (res.status !== 200) { otherError++; problems.push({ id: row.shopvox_id, url: row.download_url, status: res.status }); await sleep(RATE_LIMIT_MS); continue }

        const buf = Buffer.from(await res.arrayBuffer())
        const contentType = res.headers.get('content-type') || row.content_type || null
        const ext = extFromContentType(contentType)
        const fileName = `proof_${row.shopvox_id}.${ext}`
        const filePath = join(OUT_DIR, fileName)
        writeFileSync(filePath, buf)
        // sha256 deliberately NOT computed/sent here — shopvox_proofs has no
        // such column (confirmed live the hard way: this update used to
        // include it and PostgREST rejected the whole update every time,
        // "Could not find the 'sha256' column ... in the schema cache" — the
        // file write succeeded but storage_path silently never got recorded
        // as a result). Checksums for this table are a separate, local-only
        // backfill pass once the column exists, same as shopvox_documents'.

        // .select() forces a real returned row back, so a silent zero-row
        // match (Prefer: return=minimal's default gives no error either
        // way) is visible and treated as a failure, not just a thrown
        // error. Verbose per-row logging is deliberate here, not left over
        // — this replaced a version that only reported errors in a final
        // summary array, which is exactly why the last real run's silent
        // DB-update failures went unnoticed until an independent recount.
        const { data: updData, error: updErr } = await sb.from('shopvox_proofs').update({
          storage_path: filePath,
          content_type: contentType,
          file_size_bytes: buf.length,
        }).eq('id', row.id).select('id')
        if (updErr) {
          otherError++
          problems.push({ id: row.shopvox_id, issue: `DB update failed: ${updErr.message}` })
          console.error(`  [${row.shopvox_id}] DB update ERROR: ${updErr.message}`)
          await sleep(RATE_LIMIT_MS); continue
        }
        if (!updData || updData.length === 0) {
          otherError++
          problems.push({ id: row.shopvox_id, issue: 'DB update matched 0 rows (no error, but nothing written)' })
          console.error(`  [${row.shopvox_id}] DB update matched 0 rows — file written to disk but NOT recorded`)
          await sleep(RATE_LIMIT_MS); continue
        }

        ok++
        totalBytes += buf.length
        if (ok % 20 === 0 || ok <= 5) console.log(`  [${ok}/${rows.length}] ok — ${fileName} (${(buf.length / 1024).toFixed(0)} KB)`)
      }
    } catch (e) {
      otherError++
      problems.push({ id: row.shopvox_id, url: row.download_url, issue: e.message })
    }
    await sleep(RATE_LIMIT_MS)
  }

  console.log(`\n=== RESULT ===`)
  console.log(`  ok (downloaded/HEAD-checked): ${ok}`)
  console.log(`  backfilled from disk (no network): ${backfilled}`)
  console.log(`  404: ${notFound}`)
  console.log(`  auth required (401/403): ${authRequired}`)
  console.log(`  other error: ${otherError}`)
  console.log(`  ${DRY_RUN ? 'estimated' : 'actual'} total bytes: ${totalBytes} (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`)
  if (problems.length) {
    console.log(`\nProblems (first 20 of ${problems.length}):`)
    console.log(JSON.stringify(problems.slice(0, 20), null, 2))
  }
  if (DRY_RUN) console.log('\n--dry-run: nothing downloaded, nothing written. Pass --apply to download.')
}

main().catch((err) => { console.error('FATAL:', err.message); process.exit(1) })
