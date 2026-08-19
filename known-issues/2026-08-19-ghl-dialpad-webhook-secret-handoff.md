# 2026-08-19 — GHL + Dialpad webhooks now fail closed — secret rotation handoff required

## Status

**Code ready, held in its own PR — not merged, not deployed.** Originally bundled into PR #20
(the wider API auth sweep) but split out: PR #20's 11 other route fixes are unauthenticated
data leaks and a stray write hole with no operational downside to closing immediately. This
one is different — closing it **will break the live GHL integration on deploy**, since
`GHL_WEBHOOK_SECRET` is confirmed unset in production and GHL isn't sending a signature yet.
Held in `fix/ghl-dialpad-webhook-fail-closed` until the handoff below is actually done, so it
can merge the moment both sides are ready without blocking everything else.

`webhooks/ghl` and `webhooks/dialpad` used to fail **open**: if their secret env var wasn't
set, they skipped signature verification entirely instead of refusing the request — unlike
`shipping/webhook` (EasyPost) and `cron/invoice-iif-export`, which have always failed closed.
This branch makes both fail closed, matching those two.

**`GHL_WEBHOOK_SECRET` is confirmed NOT set in production** (per Ruben). That means
`POST /api/webhooks/ghl` is accepting unauthenticated writes **right now** — it creates real
`customers` rows and, for "quoting stage" events, real draft `quotes` rows, for anyone who
sends it a POST with no signature at all. That gap stays open until this branch merges — but
merging it before GHL is sending *something* this route accepts will just as surely break the
GHL → PrintOS lead sync, so the fix and the handoff have to land together.

Dialpad's status is unconfirmed — `DIALPAD_WEBHOOK_SECRET` is documented in `.env.example`
(unlike `GHL_WEBHOOK_SECRET`, which wasn't there at all before this branch) suggesting it may
already be set in Vercel and already working. **Check Vercel's env vars for
`DIALPAD_WEBHOOK_SECRET` before merging** — if it's already set and Dialpad is already sending
a matching signature, this fix is a no-op for Dialpad. If it's not set, Dialpad's screen-pop
webhook will also start failing closed and needs the same handoff.

## Two verification options — pick based on what GHL can actually do

GoHighLevel's no-code "Webhook" workflow action, as far as we know, can only send **static**
custom headers — it has no built-in way to compute a per-request HMAC over the outgoing body
(Dialpad is different — see below). That means the code's current signature check
(`verifySignature()` in `webhooks/ghl/route.ts`) may not be satisfiable by GHL without extra
work. Below are both real options, with the tradeoff stated plainly, so Ruben and Esteban can
pick based on what GHL's workflow builder actually supports rather than what's ideal.

### Option A — HMAC-SHA256 signature (what's implemented today)

The webhook action sends a header:

```
x-ghl-signature: sha256=<hex-encoded HMAC-SHA256 of the raw JSON request body, keyed with the shared secret>
```

Computed as `HMAC-SHA256(key = GHL_WEBHOOK_SECRET, message = <exact raw JSON body bytes GHL is
about to send>)`, hex-digested, `sha256=` prefix (a bare hex digest with no prefix also works —
the server accepts both).

- **Pros:** verifies both *who* sent the request (knows the secret) and *what* they sent (the
  signature covers the body — tampering invalidates it). Standard practice, matches
  `shipping/webhook`'s EasyPost integration.
- **Cons:** GHL likely can't compute this from its no-code webhook action alone. Needs a
  **Custom Code** workflow step (JavaScript, if the GHL plan/workflow tier supports it) that
  computes the HMAC before the webhook step fires, and sets it as a variable the webhook
  step's header can reference. If that's not available on Esteban's plan, this option is off
  the table.

### Option B — static shared-secret header (the fallback, if GHL can't do Option A)

Esteban pastes the literal secret value into a static custom header field on the webhook
action — no computation, no custom-code step:

```
x-ghl-shared-secret: <the same value Ruben put in GHL_WEBHOOK_SECRET>
```

Server-side, this replaces the HMAC check with a constant-time string compare:

```ts
import { timingSafeEqual } from 'crypto'

function verifySharedSecret(header: string | null, secret: string): boolean {
  if (!header) return false
  const a = Buffer.from(header)
  const b = Buffer.from(secret)
  // timingSafeEqual throws on length mismatch -- pad instead of early-return
  // so the check itself doesn't leak length via timing.
  return a.length === b.length && timingSafeEqual(a, b)
}
```

- **Pros:** every no-code webhook builder can do this — it's just a static header field, no
  scripting required. Trivial for Esteban to set up and trivial to rotate later.
- **Cons:** strictly weaker than Option A in two specific ways:
  - **No body integrity.** The secret proves the request came from someone who knows it, but
    doesn't cover the payload — nothing stops a request with a valid header and a *tampered*
    body (this matters less here than for, say, a payments webhook, since GHL payloads only
    ever create leads/quotes, not move money, but it's a real difference).
  - **Replayable.** Anyone who captures one valid request (e.g. via a proxy log, browser
    devtools if the header were ever exposed client-side, etc.) can replay it indefinitely —
    there's no per-request signature tying the header to that specific body/timestamp.
  - Still an enormous improvement over the current "anyone can POST, no check at all" state —
    it closes off the open-to-the-internet write hole, it's just a lower security ceiling than
    HMAC.

**Not implemented in this branch** — the code here still ships with Option A
(`verifySignature()`, HMAC). If Esteban confirms GHL can't do Option A, swapping in Option B is
a small, well-scoped follow-up (replace `verifySignature()` with `verifySharedSecret()` above,
change the header GHL sends) — do that swap *before* Ruben sets `GHL_WEBHOOK_SECRET` live, not
after, since setting the secret is what starts rejecting every request that doesn't match
whichever scheme is actually wired up.

## What Ruben needs to do (Vercel)

1. Generate a random secret (32 bytes, hex-encoded):
   ```
   openssl rand -hex 32
   ```
2. Add it to Vercel → printos project → Settings → Environment Variables:
   - `GHL_WEBHOOK_SECRET` = `<the generated value>` (Production, and Preview if GHL ever
     hits a preview deployment)
   - If Dialpad's isn't already set: `DIALPAD_WEBHOOK_SECRET` = `<a second, different
     generated value>` — do not reuse the GHL secret.
3. **Do not set `GHL_WEBHOOK_SECRET` (or merge this branch) until Esteban has confirmed which
   of Option A / Option B GHL can actually do, and that workflow side is built and sending a
   header that verifies successfully against a test secret first.** Coordinate the Vercel env
   var save and the GHL workflow change to happen together — the moment the secret is set,
   every GHL request without a valid header starts getting rejected.

## What Esteban needs to do (GHL workflow)

1. Check whether the current GHL plan/workflow supports a **Custom Code** action that can run
   JavaScript before the webhook step (needed for Option A). If yes, prefer Option A.
2. If not, use Option B: add a static custom header `x-ghl-shared-secret` to the webhook
   action, value = the secret Ruben generates.
3. Confirm back which option is being used so the server-side check matches, and test against
   a preview deployment with a throwaway test secret before Ruben rotates the real one into
   production.

## Dialpad

Dialpad is a real API platform, not a no-code builder — its webhook subscription API accepts
an `hmac_secret` at creation time and computes `x-dialpad-signature` for you natively, so
(unlike GHL) there's no open question about whether it *can* sign — only whether the webhook
subscription was ever created with a secret. Check the Dialpad admin console / whatever
created the current subscription; if it was created without `hmac_secret`, it needs to be
re-created (or updated, if Dialpad's API allows updating an existing subscription's secret)
with the same value being added to `DIALPAD_WEBHOOK_SECRET` in Vercel. Dialpad doesn't need
the Option A/B decision above — it stays on HMAC (Option A equivalent) since the platform
computes it for us.

## Related

- `src/app/api/webhooks/ghl/route.ts`, `src/app/api/webhooks/dialpad/route.ts` — the fixed
  routes (fail-closed as of this branch), currently on Option A (HMAC) for both.
- `src/app/api/shipping/webhook/route.ts`, `src/app/api/cron/invoice-iif-export/route.ts` —
  the two routes that already failed closed, used as the reference pattern.
- `.env.example` — `DIALPAD_WEBHOOK_SECRET` documented there already; `GHL_WEBHOOK_SECRET`
  added alongside it as part of this branch.
- PR #20 — the wider API auth sweep this was originally bundled into; split out here since
  those fixes have no deploy-time coordination cost and this one does.
