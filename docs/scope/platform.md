# Epic: Platform

Stack, standards, environments, identity, files, notifications, offline, release, and languages. Part of the [JP Infracon scope](index.md).

## Existing

### 1. Stack & architecture · existing
Expo Router mobile app (React Native, TypeScript, NativeWind) with an Express + tRPC API and Drizzle over managed MySQL, fixed ports 8081 and 3000. code in `./` (see root `AGENTS.md`)

### 2. Design system · existing
The Industrial Field Ledger look (JP teal, graphite, amber), portrait first, outdoor contrast, shared field UI primitives. code in `components/jp/ui.tsx`, `constants/theme.ts`, `theme.config.js`

### 3. Organisation, sites, permissions & audit · existing
First organisation, project, and site onboarding; memberships, site assignments, scoped effective dated grants, server side site scope checks, append only audit events. Configurable limits are planned separately in feature 18. code in `server/jp/access.ts`, `server/jp/policy.ts`, `server/jp/router.ts`

## Foundations

### 8. Coding standards & tooling · in-progress
Conventions are captured; add the missing enforcement (pre commit checks and a CI run of check, lint, test, build) so every later change is checked the same way.
**Done when:** root `AGENTS.md` reflects the real stack, and lint, format, typecheck, and tests run clean locally and on every push.
code in `.github/workflows/ci.yml`, `.husky/pre-commit`, `package.json` (`lint-staged`, `format:check`), `.prettierrc.json`, `eslint.config.js`
- [x] Capture conventions + tooling choices: `/audit`
- [x] Install the tooling: `/develop tooling`
- [ ] Check it runs clean: `/test`

### 9. Environment separation & backups · needs a decision · GA
Today development and production share one database. Give each environment its own database and config, document backup and restore, then apply migrations 0010 and 0011 safely.
**Done when:** dev, staging, and production use separate databases and config with an `.env.example`; a restore has been exercised; 0010 and 0011 are reviewed and applied to production with evidence.
- [ ] Design it (spec): `/architect environment separation & backups`

### 10. Error reporting · needs a decision
Catch crashes and API errors from the app and the server, with sensitive values (passwords, tokens, identity numbers, money details) redacted.
**Done when:** a thrown error on the phone and on the API shows up in one place with context, and a test proves secrets are scrubbed.
- [ ] Design it (spec): `/architect error reporting`

### 11. Text resources for translation · needs a decision
Move user facing text into string resources so no more text gets hardcoded, ready for Hindi and Odia later.
**Done when:** screens read text from a resource layer with English as the only language, and new screens follow the same pattern.
- [ ] Design it (spec): `/architect text resources for translation`

### 12. Private file evidence · needs a decision · GA
One shared way to store photos, receipts, and invoice files privately: type and size checks, checksum, authorised short lived download, and no deletion of the local copy until the server confirms.
**Done when:** an authorised user can upload and view a file tied to a record, an unauthorised user is refused on download, and approved files are never silently replaced.
- [ ] Design it (spec): `/architect private file evidence`

## Slice 1: First field release

### 13. Identity & accounts · in-progress · GA
Username and password sign in, revocable sessions, throttling, one time Super Admin bootstrap, and audited account admin exist. Still open: Super Admin recovery, editing and reassigning roles and sites, and handling legacy SSO only records.
**Done when:** a lost Super Admin can be recovered safely, an admin can change a user's role or site with an audit trail, and legacy SSO records cannot sign in without a proper account.
- [ ] Design it (spec): `/architect identity & accounts`
code in `server/_core/credential-auth.ts`, `server/jp/accounts.ts`, `app/users.tsx`, `components/jp/auth-gate.tsx`

### 21. Notification inbox · needs a decision
A server backed inbox for report states, material updates, low stock, deadlines, schedule changes, and finance reviews. The inbox is the source of truth, and opening an item checks access again.
**Done when:** a reviewer gets an inbox item when work waits on them, read state persists, and a user who lost access cannot open the item.
- [ ] Design it (spec): `/architect notification inbox`
code in `app/notifications.tsx` (placeholder screen today)

### 22. Offline drafts & sync · in-progress
Local drafts with idempotent sync exist. Still open: viewing previously synced site data offline, conflict handling that keeps both versions, last sync time, and manual retry.
**Done when:** a supervisor can open their site's recent records with no signal, a conflict shows both versions for review, and a retried sync never duplicates a record.
- [ ] Design it (spec): `/architect offline drafts & sync`
code in `lib/jp/local-repository.ts`

### 23. Android release & device QA · needs a decision · GA
A repeatable way to build a signed personal use APK from a recorded checkpoint, documented Android version support, and a device checklist for the field screens.
**Done when:** an APK built from the current checkpoint installs on a low or mid range Android phone and the core field flows pass the checklist. No Play Store publishing.
- [ ] Design it (spec): `/architect android release & device QA`

## Slice 4: Site issues and schedule depth

### 34. Escalations & push alerts · needs a decision
Push alerts on top of the inbox, with generic lock screen text and no sensitive details, plus configured escalation for severe safety issues.
**Done when:** a severe safety issue alerts the configured people, push text carries no identity or money details, and the inbox stays the source of truth.
- [ ] Design it (spec): `/architect escalations & push alerts`

## Slice 6: Languages

### 38. Hindi & Odia translations
Fill the string resources from feature 11 with Hindi and Odia, and let the user pick a language.
**Done when:** every screen reads correctly in Hindi and Odia on a phone, and missing strings fall back to English.
- [ ] Build it: `/develop hindi & odia translations`
