# Epic: Platform

Stack, standards, environments, identity, files, notifications, offline, release, and languages. Part of the [JP Infracon scope](index.md).

## Existing

### 1. Stack & architecture · existing
Expo Router mobile app (React Native, TypeScript, NativeWind) with an Express + tRPC API and Drizzle over MySQL (production in Docker on the Azure VM), fixed ports 8081 and 3000. code in `./` (see root `AGENTS.md`)

### 2. Design system · existing
The Industrial Field Ledger look (JP teal, graphite, amber), portrait first, outdoor contrast, shared field UI primitives. code in `components/jp/ui.tsx`, `constants/theme.ts`, `theme.config.js`

### 3. Organisation, sites, permissions & audit · existing
First organisation, project, and site onboarding; memberships, site assignments, scoped effective dated grants, server side site scope checks, append only audit events. Configurable limits are planned separately in feature 18. code in `server/jp/access.ts`, `server/jp/policy.ts`, `server/jp/router.ts`

## Foundations

### 8. Coding standards & tooling · done
Conventions are captured; add the missing enforcement (pre commit checks and a CI run of check, lint, test, build) so every later change is checked the same way.
**Done when:** root `AGENTS.md` reflects the real stack, and lint, format, typecheck, and tests run clean locally and on every push.
code in `.github/workflows/ci.yml`, `.husky/pre-commit`, `package.json` (`lint-staged`, `format:check`), `.prettierrc.json`, `eslint.config.js`
- [x] Capture conventions + tooling choices: `/audit`
- [x] Install the tooling: `/develop tooling`
- [x] Check it runs clean: `/test`

### 9. Environment separation & backups · in-progress · GA
Production now runs its own MySQL in Docker on the Azure VM with nightly backups, a backup before every deploy, a watchdog, and migrations applied on start; the demo server and demo APK use SQLite. Still open: a separate staging server, and a restore that has been exercised and written down.
**Done when:** production and a staging or test server use separate databases and config with an `.env.example`; a restore from backup has been exercised with evidence.
- [x] Build the first version (shipped before a spec; see `TODO.md` increments 2 to 6 November)
- [ ] Verify it: `/check verify environment separation & backups`
- [ ] Design the open items (spec): `/architect environment separation & backups`
- [ ] Test it: `/test environment separation & backups`
- [ ] Review and document it: `/check review environment separation & backups`, then `/document`
code in `deploy/docker-compose.yml`, `scripts/deploy-azure.sh`, `scripts/watchdog.sh`, `docs/deploy/self-hosting.md`

### 10. Error reporting · in-progress
Phone crashes and API errors reach `jp.feedback.appError` (queued when offline, repeats counted on one row) and show on the App problems screen; the API logs failed procedures without their input. Still open: a test that proves passwords, tokens, identity numbers and money details are scrubbed.
**Done when:** a thrown error on the phone and on the API shows up in one place with context, and a test proves secrets are scrubbed.
- [x] Build the first version (shipped before a spec; see `TODO.md` increment 5 November (1.5.0))
- [ ] Verify it: `/check verify error reporting`
- [ ] Design the open items (spec): `/architect error reporting`
- [ ] Test it: `/test error reporting`
code in `lib/error-reporter.ts`, `server/jp/reports.ts`, `lib/jp/app-reports.ts`, `app/app-reports.tsx`

### 11. Text resources for translation · in-progress
UI text goes through `useT()` with English keys, and a test keeps the Hindi and Odia tables in step. Still open: help guide text and some deeper screens still in English only.
**Done when:** screens read text from a resource layer with English as the only language, and new screens follow the same pattern.
- [x] Build the first version (shipped before a spec; see `TODO.md` increment 2 November (b))
- [ ] Verify it: `/check verify text resources for translation`
- [ ] Design the open items (spec): `/architect text resources for translation`
- [ ] Test it: `/test text resources for translation`
code in `lib/i18n/`

### 12. Private file evidence · in-progress · GA
JPEG, PNG, WebP and PDF up to 8 MB, type checked from file bytes, SHA-256 checksum, no replacement, opened only through a short lived signed link after a fresh permission check; disk or S3 storage when self hosted. Still open: keeping the phone copy until the server confirms.
**Done when:** an authorised user can upload and view a file tied to a record, an unauthorised user is refused on download, and approved files are never silently replaced.
- [x] Build the first version (shipped before a spec; see `TODO.md` increment 2 November (b))
- [ ] Verify it: `/check verify private file evidence`
- [ ] Design the open items (spec): `/architect private file evidence`
- [ ] Test it: `/test private file evidence`
- [ ] Review and document it: `/check review private file evidence`, then `/document`
code in `server/jp/attachments.ts`, `lib/jp/attachment-policy.ts`, `server/storage.ts`

## Slice 1: First field release

### 13. Identity & accounts · in-progress · GA
Username and password sign in, revocable sessions, throttling, one time Super Admin bootstrap, audited account admin, invite codes, and worker PIN sign in. Still open: Super Admin recovery and handling legacy SSO only records.
**Done when:** a lost Super Admin can be recovered safely, an admin can change a user's role or site with an audit trail, and legacy SSO records cannot sign in without a proper account.
- [x] Build the first version (shipped before a spec; see `TODO.md` increments 2 to 5 November)
- [ ] Verify it: `/check verify identity & accounts`
- [ ] Design the open items (spec): `/architect identity & accounts`
- [ ] Test it: `/test identity & accounts`
- [ ] Review and document it: `/check review identity & accounts`, then `/document`
code in `server/_core/credential-auth.ts`, `server/jp/accounts.ts`, `app/users.tsx`, `components/jp/auth-gate.tsx`

### 21. Notification inbox · in-progress
A live inbox derived from persisted records (reviews, approvals, returned reports, custody, overdue tasks, issues, POs, dues, advances, worker help requests). Still open: stored read state, and checking access again when an item is opened.
**Done when:** a reviewer gets an inbox item when work waits on them, read state persists, and a user who lost access cannot open the item.
- [x] Build the first version (shipped before a spec; see `TODO.md` increment 2 November)
- [ ] Verify it: `/check verify notification inbox`
- [ ] Design the open items (spec): `/architect notification inbox`
- [ ] Test it: `/test notification inbox`
code in `server/jp/inbox.ts`, `app/notifications.tsx`

### 22. Offline drafts & sync · in-progress
Local drafts with idempotent sync, the query cache kept on the phone so synced records stay viewable offline, and offline issue drafts sent on reconnect. Still open: conflict handling that keeps both versions, last sync time, and manual retry.
**Done when:** a supervisor can open their site's recent records with no signal, a conflict shows both versions for review, and a retried sync never duplicates a record.
- [x] Build the first version (shipped before a spec; see `TODO.md` increment 2 November)
- [ ] Verify it: `/check verify offline drafts & sync`
- [ ] Design the open items (spec): `/architect offline drafts & sync`
- [ ] Test it: `/test offline drafts & sync`
code in `lib/jp/local-repository.ts`, `app/_layout.tsx`, `hooks/use-issue-draft-sync.ts`

### 23. Android release & device QA · in-progress · GA
Signed personal use APKs build on EAS (production and demo profiles), up to version 1.5.5, with the server address set on the sign in screen. Still open: documented Android version support and a device checklist run on a low or mid range phone.
**Done when:** an APK built from the current commit installs on a low or mid range Android phone and the core field flows pass the checklist. No Play Store publishing.
- [x] Build the first version (shipped before a spec; see `TODO.md` increments 2 to 6 November)
- [ ] Verify it: `/check verify android release & device qa`
- [ ] Design the open items (spec): `/architect android release & device qa`
- [ ] Test it: `/test android release & device qa`
- [ ] Review and document it: `/check review android release & device qa`, then `/document`
code in `eas.json`, `app.config.ts`

## Slice 4: Site issues and schedule depth

### 34. Escalations & push alerts · in-progress
Expo push, WhatsApp (OpenWA and others) and SMS alerts with per role rules, personal mutes and opt ins, on critical issues, assignments, delegation, presence and more, with a delivery log that stores no message bodies. Still open: configured escalation when nobody acts on a severe issue.
**Done when:** a severe safety issue alerts the configured people, push text carries no identity or money details, and the inbox stays the source of truth.
- [x] Build the first version (shipped before a spec; see `TODO.md` increment 2 November (c))
- [ ] Verify it: `/check verify escalations & push alerts`
- [ ] Design the open items (spec): `/architect escalations & push alerts`
- [ ] Test it: `/test escalations & push alerts`
code in `server/jp/notify.ts`, `lib/jp/alert-rules.ts`, `app/alert-settings.tsx`

## Slice 6: Languages

### 38. Hindi & Odia translations · in-progress
Hindi and Odia for most screens, chosen on the sign in screen or in More, with English fallback. Still open: help guide text, a native speaker review, and the remaining English only screens.
**Done when:** every screen reads correctly in Hindi and Odia on a phone, and missing strings fall back to English.
- [x] Build the first version (shipped before a spec; see `TODO.md` increments 2 to 6 November)
- [ ] Verify it: `/check verify hindi & odia translations`
- [ ] Design the open items (spec): `/architect hindi & odia translations`
- [ ] Test it: `/test hindi & odia translations`
code in `lib/i18n/strings.ts`
