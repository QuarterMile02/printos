// Auth surface configuration.
//
// ── PUBLIC_SIGNUP_ENABLED ────────────────────────────────────────────────
// PrintOS is invite-only until cutover. Flip this to `true` to re-open
// public self-service signup. It is the ONLY switch: the /signup server
// action refuses before it reaches supabase.auth.signUp(), and the /signup
// page renders an explanatory notice instead of a form. Both read this
// constant, so re-opening is a one-line change.
//
// WHY IT IS CLOSED
//
// Public signup created an ORPHAN account, not a usable one. The chain:
//
//   supabase.auth.signUp()
//     → trigger on_auth_user_created (migration 001:238)
//       → handle_new_user() inserts into profiles (id, full_name, avatar_url)
//         — and nothing else
//     → profiles.role  defaults to 'production'  (migration 011:10)
//     → profiles.tier  defaults to 'staff'       (migration 011:12)
//     → profiles.organization_id stays NULL
//     → no organization_members row is ever written
//
// Nothing in that path asks which organization the account belongs to,
// because self-service signup has no answer to that question. The result is
// a real, confirmed, signed-in account attached to no org — and before
// PR #57 it was worse than useless: checkPermission() evaluated role/tier
// without comparing profile.organization_id to the requested org, so an
// orphan carrying the 'production' default was authorized against EVERY
// org. PR #57 closed that; this closes the door that produced the orphans.
// One such account exists today (created 2026-08-17) and is now correctly
// denied everywhere.
//
// WHAT MUST BE TRUE BEFORE RE-OPENING
//
// Signup has to answer "which organization?" at account-creation time, and
// answer it from something the signing-up user cannot choose freely.
// Concretely, all three:
//
//   1. Invitation-gated org assignment. A signup carries a token that
//      resolves to exactly one organization_invites row, and the account is
//      created with that row's organization_id and role — never with the
//      schema defaults. Note that organization_invites TODAY is written by
//      settings/team's inviteMember() and read by nobody: there is no accept
//      path, no token delivery, and no email. That has to be built; it does
//      not exist.
//   2. Profile + membership written together. A profile with a NULL
//      organization_id and no organization_members row must not be a
//      reachable end state of any signup. Today handle_new_user() can only
//      produce that state.
//   3. For the franchise product specifically: a decision on whether a
//      brand-new org can be created from a public form at all, and if so
//      what stops one signup from minting unlimited orgs. Nothing in the
//      current schema constrains that.
//
// Until all three hold, flipping this to `true` re-creates orphans.
//
// Deliberately NOT affected by this switch, because none of them is public
// self-service signup: /login, /reset-password and /forgot-password (they
// authenticate accounts that already exist), /portal/login and
// /portal/accept-invite (the CUSTOMER portal — a separate auth surface with
// its own token-gated creation path in src/app/portal/actions.ts), and
// scripts/seed-qmi-team.mjs, which is how staff accounts are actually made
// today via supabase.auth.admin.inviteUserByEmail().
export const PUBLIC_SIGNUP_ENABLED = false
