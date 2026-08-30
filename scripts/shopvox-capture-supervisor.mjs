/**
 * shopvox-capture-supervisor.mjs
 *
 * TASK AL steps 2a/2c/3 (2026-08-26). Wraps shopvox-capture.mjs so a fourth
 * silent death doesn't happen a fifth time. Built after capture death #4:
 * 29 hours, 41,766 records, a heap OOM against this machine's 2.19 GiB
 * default Node heap (see Task AK / SHOPVOX_MIGRATION_NOTES.md) — and NOT ONE
 * byte of error text survived it, because the console window that showed it
 * is the only place it was ever written.
 *
 * Three things this script does, none of them optional:
 *
 * 1. Always launches the child with --max-old-space-size=8192 (Task AL step
 *    1's real fix — undisposed Playwright APIResponse objects in
 *    scripts/lib/shopvox-api.mjs, now fixed — makes this belt-and-suspenders,
 *    not the load-bearing fix) AND --report-on-fatalerror
 *    --report-directory=<capture dir> (step 2a), so a V8 abort writes a
 *    report.*.json next time instead of vanishing.
 * 2. Redirects the child's stdout+stderr to scripts/capture/_capture_stdout.log
 *    in append mode, with a timestamped banner per launch (step 2c) — a
 *    console window is never again the only copy.
 * 3. Restarts the child on an unexpected exit, bounded (step 3):
 *      - MAX_RESTARTS relaunches, no more.
 *      - Hard stop if the child dies twice in a row within
 *        QUICK_DEATH_WINDOW_MS of ITS OWN start (a genuine, fast crash loop
 *        — not a transient blip worth burning the restart budget on).
 *      - NEVER restarts after a clean completion. "Clean" is decided by
 *        re-reading the queue file after the child exits and checking
 *        whether anything is still status:'pending' — not by the child's
 *        exit code alone, because an OOM abort's exit code isn't reliably
 *        predictable across platforms/Node builds. If nothing is pending,
 *        the run is done, full stop, regardless of how it exited.
 *      - Also stops (without restarting) if the child's own output shows it
 *        hit maxOuterIterations — shopvox-capture.mjs's own FATAL text for
 *        "some row is stuck pending and drain() never resolved it," a real
 *        bug that a restart cannot fix and would just loop into again.
 *
 * Restarting is safe BY DESIGN, not just convenient (Ruben, 2026-08-26):
 * every captured record is flushed to its own file immediately
 * (writeRecordFile()), the queue checkpoint is append-only and atomically
 * rewritten (flushQueue()'s tmp-then-rename), and a stale lock left by an
 * abrupt kill self-heals on the very next launch (acquireLock()'s
 * isPidAlive() check — confirmed live, Task AK). A restart after a crash
 * picks up exactly where the dead process left off.
 *
 * Usage: same flags as shopvox-capture.mjs, passed straight through.
 *   node scripts/shopvox-capture-supervisor.mjs [--queue=...] [--entity=...] ...
 * Do NOT pass --max-old-space-size or --report-on-fatalerror yourself —
 * this script always adds them to the child's own invocation.
 */
import { spawn } from 'node:child_process'
import { readFileSync, appendFileSync, mkdirSync, existsSync, openSync, closeSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = __dir
const CAPTURE_SCRIPT = join(root, 'shopvox-capture.mjs')
const CAPTURE_DIR = join(root, 'capture')
if (!existsSync(CAPTURE_DIR)) mkdirSync(CAPTURE_DIR, { recursive: true })
const STDOUT_LOG = join(CAPTURE_DIR, '_capture_stdout.log')
const SUPERVISOR_LOG = join(CAPTURE_DIR, '_supervisor_log.jsonl')

const passthroughArgs = process.argv.slice(2)
function getFlag(name) { const a = passthroughArgs.find((a) => a.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null }
// Same default queue path shopvox-capture.mjs itself uses, so the pending-
// check below looks at the same file the child is actually draining.
const QUEUE_PATH = getFlag('queue') ? join(process.cwd(), getFlag('queue')) : join(root, 'queue', 'queue.jsonl')

const MAX_RESTARTS = 10
const QUICK_DEATH_WINDOW_MS = 5 * 60 * 1000 // "dies twice inside five minutes" — measured as the CHILD's own lifetime, not the gap between launches
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function supervisorLog(event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event })
  console.log(`[supervisor] ${line}`)
  try { appendFileSync(SUPERVISOR_LOG, line + '\n') } catch {}
}

// Ground truth for "is there still work to do" — deliberately NOT the
// child's exit code (an OOM abort's exit code isn't reliably predictable
// across platforms/Node builds; a plain SIGKILL-equivalent might not even
// set one meaningfully). Not filtered by --entity/--range even if the child
// run was scoped that way — a conservative superset check: if this reports
// pending work that the child's own filter wouldn't have picked up anyway,
// the worst case is one harmless extra restart that finds nothing to do and
// exits immediately clean, not a wrong decision.
function anyPending() {
  try {
    const rows = readFileSync(QUEUE_PATH, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    return rows.some((r) => r.status === 'pending')
  } catch (e) {
    supervisorLog({ event: 'queue_read_failed', error: e.message, note: 'cannot determine pending state — treating as nothing pending so this does NOT blindly restart into an unknown situation' })
    return false
  }
}

function hitMaxOuterIterations() {
  try {
    const tail = readFileSync(STDOUT_LOG, 'utf8').slice(-4000)
    return tail.includes('maxOuterIterations') && tail.includes('FATAL')
  } catch { return false }
}

function runOnce(attempt) {
  return new Promise((resolve) => {
    const args = [
      '--max-old-space-size=8192',
      '--report-on-fatalerror',
      `--report-directory=${CAPTURE_DIR}`,
      CAPTURE_SCRIPT,
      ...passthroughArgs,
    ]
    supervisorLog({ event: 'launch', attempt, args })
    appendFileSync(STDOUT_LOG, `\n\n===== supervisor launch #${attempt} at ${new Date().toISOString()} (pid TBD) =====\n`)
    const outFd = openSync(STDOUT_LOG, 'a')
    const startedAt = Date.now()
    let child
    try {
      // cwd: process.cwd() (the supervisor's OWN invocation directory), NOT
      // `root` (the scripts/ dir) — CAUGHT LIVE on the very first real launch
      // (2026-08-26): shopvox-capture.mjs resolves --queue=<path> as
      // join(process.cwd(), path), exactly like it does when run directly.
      // Spawning with cwd: root silently doubled that to
      // scripts\scripts\queue\queue.jsonl.lock (ENOENT, crash before
      // touching anything real) whenever --queue was passed as a
      // project-root-relative path — i.e. exactly how the launch command in
      // this project's own usage line invokes it. The quick-death hard-stop
      // caught this after 2 attempts and did NOT burn through all 10
      // restarts or spin — the safety mechanism worked exactly as designed
      // on its first real test, even though the bug it caught was mine.
      child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ['ignore', outFd, outFd] })
    } catch (err) {
      closeSync(outFd)
      supervisorLog({ event: 'spawn_error', attempt, error: err.message })
      resolve({ code: null, signal: null, elapsedMs: Date.now() - startedAt, spawnError: err.message })
      return
    }
    supervisorLog({ event: 'spawned', attempt, pid: child.pid })
    child.on('exit', (code, signal) => {
      closeSync(outFd)
      resolve({ code, signal, elapsedMs: Date.now() - startedAt })
    })
    child.on('error', (err) => {
      try { closeSync(outFd) } catch {}
      supervisorLog({ event: 'child_error', attempt, error: err.message })
      resolve({ code: null, signal: null, elapsedMs: Date.now() - startedAt, spawnError: err.message })
    })
  })
}

async function main() {
  console.log(`Supervisor starting.`)
  console.log(`  child script: ${CAPTURE_SCRIPT}`)
  console.log(`  queue (pending-check target): ${QUEUE_PATH}`)
  console.log(`  passthrough args: ${JSON.stringify(passthroughArgs)}`)
  console.log(`  stdout/stderr log: ${STDOUT_LOG}`)
  console.log(`  supervisor log: ${SUPERVISOR_LOG}`)
  console.log(`  MAX_RESTARTS=${MAX_RESTARTS}  QUICK_DEATH_WINDOW_MS=${QUICK_DEATH_WINDOW_MS}`)

  let attempt = 0
  let consecutiveQuickDeaths = 0
  for (;;) {
    attempt++
    const result = await runOnce(attempt)
    const pending = anyPending()
    supervisorLog({ event: 'exit', attempt, code: result.code, signal: result.signal, elapsedMs: result.elapsedMs, pendingRemains: pending })

    if (!pending) {
      supervisorLog({ event: 'stopping', reason: 'queue has nothing pending after this run — clean completion, not restarting regardless of exit code' })
      break
    }

    if (hitMaxOuterIterations()) {
      supervisorLog({ event: 'stopping', reason: 'child hit maxOuterIterations — a real bug (some row stuck pending, drain() never resolved it), not something a restart fixes. Needs a human — inspect the queue for stuck pending rows before re-running.' })
      break
    }

    if (result.elapsedMs < QUICK_DEATH_WINDOW_MS) {
      consecutiveQuickDeaths++
      if (consecutiveQuickDeaths >= 2) {
        supervisorLog({ event: 'stopping', reason: `child died twice in a row within ${QUICK_DEATH_WINDOW_MS / 1000}s of its own start each time (last: ${result.elapsedMs}ms) — hard stop, this is a real crash loop, not a transient blip. Needs a human.` })
        break
      }
    } else {
      consecutiveQuickDeaths = 0 // a run that survived past the window resets the streak
    }

    if (attempt >= MAX_RESTARTS) {
      supervisorLog({ event: 'stopping', reason: `hit MAX_RESTARTS=${MAX_RESTARTS} without a clean completion. Needs a human.` })
      break
    }

    supervisorLog({ event: 'restarting', reason: `pending work remains (exit code=${result.code}, signal=${result.signal}, ran ${Math.round(result.elapsedMs / 1000)}s), restart ${attempt}/${MAX_RESTARTS}` })
    await sleep(5000) // brief pause — cheap insurance against hammering anything in a tight loop, not load-bearing given the quick-death check above
  }

  console.log('Supervisor exiting.')
}

main().catch((e) => { console.error('SUPERVISOR FATAL:', e); process.exit(1) })
