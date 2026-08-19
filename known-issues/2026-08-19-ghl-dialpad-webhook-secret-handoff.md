# 2026-08-19 — GHL + Dialpad webhooks now fail closed — secret rotation handoff required

## Status

**Code fixed, NOT deployed live yet.** `webhooks/ghl` and `webhooks/dialpad` used to fail
**open**: if their secret env var wasn't set, they skipped signature verification entirely
instead of refusing the request — unlike `shipping/webhook` (EasyPost) and
`cron/invoice-iif-export`, which have always failed closed. Both now fail closed, matching
those two.

**`GHL_WEBHOOK_SECRET` is confirmed NOT set in production** (per Ruben). That means
`POST /api/webhooks/ghl` is accepting unauthenticated writes **right now** — it creates real
`customers` rows and, for "quoting stage" events, real draft `quotes` rows, for anyone who
sends it a POST with no signature at all.

Once this fix deploys, that gap closes automatically — but the GHL integration **stops
working** at the same moment, because GHL isn't sending a signature GHL's requests will now
get rejected with `401 Invalid signature` (or `500` if the code deploys before the secret is
set at all) until both sides agree on a shared secret. **Do not deploy this fix without doing
the handoff below first**, or the GHL → PrintOS lead sync silently stops.

Dialpad's status is unconfirmed — `DIALPAD_WEBHOOK_SECRET` is documented in `.env.example`
(unlike `GHL_WEBHOOK_SECRET`, which isn't there at all) suggesting it may already be set in
Vercel and already working. **Check Vercel's env vars for `DIALPAD_WEBHOOK_SECRET` before
deploying** — if it's already set and Dialpad is already sending a matching signature, this
fix is a no-op for Dialpad. If it's not set, Dialpad's screen-pop webhook will also start
failing closed and needs the same handoff.

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
3. **Do not deploy this branch's merge until Esteban confirms the GHL workflow side (below)
   is sending a matching signature** — coordinate the Vercel env var save and the GHL
   workflow change to happen together, since the moment `GHL_WEBHOOK_SECRET` is set, every
   GHL request without a valid signature starts getting rejected.

## What Esteban needs to configure (GHL workflow)

The webhook action needs to send a request that includes a header:

```
x-ghl-signature: sha256=<hex-encoded HMAC-SHA256 of the raw JSON request body, keyed with the shared secret>
```

This is computed as: `HMAC-SHA256(key = GHL_WEBHOOK_SECRET, message = <exact raw JSON body
bytes GHL is about to send>)`, hex-digested, with a `sha256=` prefix. (A bare hex digest with
no prefix also works — the server accepts both — but include the prefix for clarity.)

**Open question, needs Esteban to confirm before Ruben rotates the secret in:** GoHighLevel's
no-code "Webhook" workflow action (as far as we know) can only send **static** custom
headers — it has no built-in way to compute a per-request HMAC over the outgoing body. If
that's still true, GHL cannot satisfy the signature check above without an extra step, e.g.:

- A **Custom Code** workflow action (if the GHL plan/workflow supports it) that computes the
  HMAC in JavaScript before the webhook step, using the same secret, and sets it as a
  variable the webhook step's header can reference.
- Or, if that's not workable, we simplify the check on our side to a **static shared-secret
  header** instead of a computed HMAC (Esteban pastes the literal secret value into a custom
  header field, e.g. `x-ghl-shared-secret: <secret>`, and we do a constant-time string
  compare instead of an HMAC comparison). This is a real, if slightly weaker, alternative —
  say so and we'll swap `webhooks/ghl`'s `verifySignature()` for a plain compare before
  Ruben sets the secret live.

**Do not have Ruben set `GHL_WEBHOOK_SECRET` in Vercel until Esteban has confirmed which of
these two GHL can actually do**, and, if it's the custom-code path, until that workflow step
is built and sending a header that verifies successfully against a test secret in a preview
deploy first.

## Dialpad

Dialpad is a real API platform, not a no-code builder — its webhook subscription API accepts
an `hmac_secret` at creation time and computes `x-dialpad-signature` for you natively, so
(unlike GHL) there's no open question about whether it *can* sign — only whether the webhook
subscription was ever created with a secret. Check the Dialpad admin console / whatever
created the current subscription; if it was created without `hmac_secret`, it needs to be
re-created (or updated, if Dialpad's API allows updating an existing subscription's secret)
with the same value being added to `DIALPAD_WEBHOOK_SECRET` in Vercel.

## Related

- `src/app/api/webhooks/ghl/route.ts`, `src/app/api/webhooks/dialpad/route.ts` — the fixed
  routes (fail-closed as of this commit).
- `src/app/api/shipping/webhook/route.ts`, `src/app/api/cron/invoice-iif-export/route.ts` —
  the two routes that already failed closed, used as the reference pattern.
- `.env.example` — `DIALPAD_WEBHOOK_SECRET` documented there already; `GHL_WEBHOOK_SECRET`
  added alongside it as part of this change.
