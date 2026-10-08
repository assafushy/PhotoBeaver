# Session summary: M5.5 Users and roles (2026-10-08)

Branch: `m5-5-users`. Plan: `claude_docs/plans/2026-10-08_m5-5-users_plan.md`. Decisions D135 to D151 in `docs/DECISIONS.md`.

## What was built

- **Access contracts:** public channels, the `LOCKED` error, `session.changed`, and a test that pins every channel to its SPEC 3.3 permission.
- **Accounts:** `UserService` (create, update, delete, scopes, multi-user on and off, auto-lock), argon2id hashing, an attempt limiter, a recovery key, and the last-Admin guard.
- **Sessions:** `SessionService` with sign-in, Touch ID, recovery, lock and refresh; idle auto-lock; an app menu with Lock and Switch user.
- **Scopes:** `scopeCondition` applied to every read path, `pb-media` and `thumbs.ready` (subagent, verified by me).
- **Editor features:** favorite, hide, user tags, date and location, user albums, re-run enrichment, an Albums screen (subagent).
- **UI:** sign-in screen with picker, PIN or password, Touch ID and recovery; Settings with the multi-user flow; Users screen with a scope picker; Activity (audit log); a nav built from permissions (subagent).
- **Audit:** people, album, edit, settings, user and sign-in events.
- **Quit redesign:** kill plugin hosts and `app.exit(0)` with a deadline; `closeApp` fails on a hang again.
- **Tooling:** `pnpm check:fn` in CI.

## Verification

- Lint, typecheck, unit, plugin and integration tests, Prettier and `check:fn` pass.
- All 25 e2e tests pass, including the M5.5 acceptance: an album-scoped Viewer sees only album photos, search and a guessed thumbnail find nothing outside; an Editor tags and merges but can't add sources or change plugins; the last Admin can't be demoted; sync runs while locked.
- Packaged macOS build: turning on multi-user, restarting, and signing in on the sign-in screen work.
- Manual, for you: Touch ID sign-in on a Mac.

## AI Rationale

- **SQL-level scopes with one helper.** Filtering in the renderer or per service would leak through any missed path. One `scopeCondition` used everywhere plus a matrix test over every read service makes leaks visible. Out of scope answers like not found so ids can't be probed.
- **Public channel flag instead of a separate locked API.** The registry already checks every call; marking five channels public keeps one enforcement point and makes the locked surface explicit and testable.
- **hash-wasm over native argon2.** Native modules need per-OS builds in the main process; WASM is about 50 ms per hash at OWASP parameters, fine for sign-in.
- **Recovery key resets the oldest Admin.** Simpler than per-user keys and matches the single-household threat model in SPEC 3.3.
- **Quit redesign.** Two root-cause fixes for the Windows hang did not hold. Instead of depending on Electron's quit sequence and plugin `deactivate` round trips, quit now kills hosts and exits directly. Plugin work is durable and re-runs, so nothing is lost. Option considered: keep the e2e kill fallback (D134), rejected because it hid hangs.
- **Error messages, not codes, in the renderer.** The context bridge drops custom error fields; carrying the code inside the message was possible but matching messages was simpler for now.
- **Trade-offs:** people merge moves faces the Editor can't see (D144); the library lock file stays deferred (D149).
