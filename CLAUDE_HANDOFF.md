# JP Infracon — Claude Code handoff

Snapshot date: 2 November 2026. This source archive is for continuing the JP Infracon construction-management app from the supplied production-ready PRD; it is not a claim that every PRD outcome is complete.

## Project and current state

The project is an Expo / React Native / TypeScript mobile app with an Express + tRPC API and Drizzle ORM over managed MySQL. `TODO.md` contains the full acceptance criteria and the authoritative remaining-outcome list. `plan.md` records the implementation and design choices. The original user-provided PRD is included at `docs/JP_Infracon_Production_Ready_PRD.md`.

The latest archive includes the custom username/password identity system, role/site enforcement, supplier and invoice workflows, the internal supplier-payment allocation ledger, and an in-progress petty-cash ledger. Petty cash supports named site funds and custodian acknowledgement, funding/expense/linked cash-return records, exact-paise derived balances, limits, reasoned maker-checker transitions and audit history. Expense creation now requires an explicit attestation that it was paid from the selected site fund; personal out-of-pocket expenses are rejected by the API and belong to the still-unimplemented reimbursement workflow. Task labels are stored as movement snapshots so later task edits cannot rewrite cash-ledger history.

The petty-cash feature is not complete: physical cash reconciliation/variance adjustment, secure receipt upload/download, and supervisor reimbursement liabilities remain open. Other PRD outcomes remain in `TODO.md`; do not infer completion from the presence of a screen or route.

## Checks already run

The latest source passed `pnpm check`, all 90 database-free Vitest tests, `pnpm build`, `npx expo export --platform web --output-dir /tmp/jp-web-export-cash-attestation`, and `git diff --check` before migration 0011 was generated. The generated 0011 migration contains only additive columns for source attestation and immutable task snapshots.

## Database caution

The managed shared database has migrations through 0009. Migrations 0010 and 0011 are included here but were **not applied** at the time of packaging. Migration 0010 creates petty-cash fund/movement tables; 0011 adds expense-source attestation and task snapshots. Review both SQL files before application. The managed database is shared by development and production: do not use it for tests, seed fake operational data, or run destructive cleanup. No user, supplier, invoice, payment, cash-fund or operational demo records were found or seeded in the audited environment.

## Credentials and payment boundary

No environment values, API credentials, user passwords, bootstrap secret values, signing keys, or keystores are included. `JP_SUPERADMIN_BOOTSTRAP_SECRET` is managed through protected environment configuration; never request or paste its value in chat, source files, logs or Git. The first Super Admin must be created through the one-time bootstrap flow. No default, demo or universal login credentials are provided.

Supplier-payment and cash-ledger entries record internal user-entered business records only; they do not execute or bank-verify transfers. Do not add bank/payment execution without explicit authorization. Do not publish to Google Play; the user authorized personal-use APK distribution only.

## Mobile release/checkpoint status

The source changes in this archive are newer than the last pushed source commit and are a workspace snapshot, not a Git clone with history. Dashboard Version History still showed checkpoint `50df579`; the later pushed `b958c793` was not visible there. Do not claim this archive has a Dashboard checkpoint or that an APK was built from this exact source. An older personal-use APK 1.0.2 was downloaded from the Dashboard, but it is not a device-verified or store-published release. Only use Dashboard Build after the intended current source is shown as a recorded checkpoint; do not build or publish an older Version History entry.

## Suggested local commands

Install dependencies using the repository’s existing lockfile and toolchain, then run:

```sh
pnpm check
pnpm test
pnpm build
npx expo export --platform web --output-dir /tmp/jp-web-export
```

The Mobile runtime uses fixed ports 8081 (Expo Metro) and 3000 (API). Follow the Expo template and current project configuration for starting Preview. Do not put absolute internal preview URLs into app configuration.

Before continuing, read `TODO.md`, `plan.md`, the full included PRD, and the relevant Webdev database/authentication/storage guidance. Continue outcomes sequentially, preserve server-side authorization and auditability, and mark an outcome complete only with evidence that its behavior is actually delivered.
