/**
 * queue-repair-from-disk.mjs
 *
 * Rebuilds a queue file's done/pending status from disk ground truth,
 * discarding whatever the queue file itself currently claims. For each row,
 * marks it `done` if and only if scripts/capture/<entity>/<uuid>.json
 * exists; otherwise `pending`. This is the recovery path after two
 * concurrent shopvox-capture.mjs writers raced on the same queue file and
 * clobbered each other's checkpoint flushes — the captured JSON files on
 * disk were never at risk (each is a single atomic writeFileSync by
 * whichever process handled that record), only the queue's bookkeeping was.
 *
 * File-and-disk only. No network, no browser, no Supabase.
 *
 * Usage:
 *   node scripts/queue-repair-from-disk.mjs --queue=scripts/queue/customer-<uuid>.jsonl
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = __dir
const CAPTURE_DIR = join(root, 'capture')

const argv = process.argv.slice(2)
function getFlag(name) { const a = argv.find((a) => a.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null }
const QUEUE_PATH = getFlag('queue') ? join(process.cwd(), getFlag('queue')) : null
if (!QUEUE_PATH) { console.error('FATAL: --queue=<path> is required'); process.exit(1) }
if (!existsSync(QUEUE_PATH)) { console.error(`FATAL: ${QUEUE_PATH} does not exist`); process.exit(1) }

const rows = readFileSync(QUEUE_PATH, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
console.log(`Loaded ${rows.length} rows from ${QUEUE_PATH}`)

const changes = { pendingToDone: 0, doneToPending: 0, failedToDone: 0, failedToPending: 0, noChange: 0, skippedUntouched: 0 }
const byEntityChange = {} // entity -> { toDone, toPending }

for (const row of rows) {
  // 'skipped' rows are a distinct, permanent status — a row deliberately
  // marked as a known-phantom duplicate (see the job.orderId mistagging bug
  // in scripts/SHOPVOX_MIGRATION_NOTES.md), never fetched by design, so it
  // will NEVER have a capture file on disk. The done/pending binary below
  // would otherwise reclassify it back to 'pending' every time this script
  // runs — silently undoing the skip and re-exposing a known-dead uuid as
  // something still needing capture. Leave it alone, always.
  if (row.status === 'skipped') { changes.skippedUntouched++; continue }

  const filePath = join(CAPTURE_DIR, row.entity, `${row.shopvox_uuid}.json`)
  const fileExists = existsSync(filePath)
  const newStatus = fileExists ? 'done' : 'pending'
  const oldStatus = row.status

  if (!byEntityChange[row.entity]) byEntityChange[row.entity] = { toDone: 0, toPending: 0 }

  if (oldStatus === newStatus) { changes.noChange++; continue }

  if (newStatus === 'done') {
    if (oldStatus === 'pending') changes.pendingToDone++
    else if (oldStatus === 'failed') changes.failedToDone++
    byEntityChange[row.entity].toDone++
  } else {
    if (oldStatus === 'done') changes.doneToPending++
    else if (oldStatus === 'failed') changes.failedToPending++
    byEntityChange[row.entity].toPending++
  }

  row.status = newStatus
  if (newStatus === 'pending') { delete row.captured_at; delete row.error } // stale from the old (possibly wrong) status
}

const totalChanged = changes.pendingToDone + changes.doneToPending + changes.failedToDone + changes.failedToPending
console.log(`\n=== Changes ===`)
console.log(`  pending -> done:  ${changes.pendingToDone}  (file existed on disk, queue hadn't caught up)`)
console.log(`  done -> pending:  ${changes.doneToPending}  (queue claimed done, no file on disk — checkpoint loss from the race)`)
console.log(`  failed -> done:   ${changes.failedToDone}`)
console.log(`  failed -> pending: ${changes.failedToPending}`)
console.log(`  no change:        ${changes.noChange}`)
console.log(`  skipped (untouched): ${changes.skippedUntouched}  (known-phantom rows, never reconsidered)`)
console.log(`  TOTAL changed:    ${totalChanged}`)

console.log(`\n=== By entity ===`)
for (const [entity, c] of Object.entries(byEntityChange).sort()) {
  if (c.toDone || c.toPending) console.log(`  ${entity}: +${c.toDone} done, +${c.toPending} pending`)
}

const finalByStatus = {}
for (const r of rows) finalByStatus[r.status] = (finalByStatus[r.status] || 0) + 1
console.log(`\n=== Final status counts ===`)
console.log(` `, JSON.stringify(finalByStatus))

const tmp = QUEUE_PATH + '.tmp'
writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
renameSync(tmp, QUEUE_PATH)
console.log(`\nWrote repaired queue to ${QUEUE_PATH}`)
