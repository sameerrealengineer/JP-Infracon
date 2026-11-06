# JP business API

## Overview

Protected tRPC procedures for every JP Infracon feature. Each module checks the caller's site scope and permission, validates input with Zod, writes inside a transaction, and records an audit event. Mounted as `jp` in `server/routers.ts`.

## Key files

| File | Owns |
|---|---|
| `router.ts` | `jpRouter`: sites, dashboard, daily reports, material requests, audit, the `permissionKeys` list, site capabilities |
| `access.ts` | `getSiteScope(user, siteId, permissionKey)` and `getAccessibleSites`: membership, site assignment, and grant checks |
| `policy.ts` | Role to permission resolution with scoped, effective dated grants (`resolveSitePermission`, `resolveOrganizationPermission`) |
| `accounts.ts` | Organisation user and site account administration |
| `tasks.ts` | Tasks, Finish to Start dependencies, rescheduling with impact preview; `assign` (`task.manage`) sets the responsible person (must be on the site team) and crew (open crew of the site), audited as `task.assigned` |
| `workforce.ts` | Workers, KYC review, effective dated rates |
| `inventory.ts` | Catalogue, stock movements, derived stock |
| `sites-admin.ts` | Projects and sites: create, edit, status changes with reason, site team assign/remove (`site.manage`, organisation level) |
| `inbox.ts` | `buildInbox`: the derived notification inbox (reviews, approvals, returned reports, custody, overdue tasks) |
| `capabilities.ts` | `permissionKeys`, `siteCapabilities`, `sitesWithPermission` (shared by the router and newer modules) |
| `issues.ts` | Safety/quality/constraint issues: report, assign, start/resolve/close/send back/reopen, comments |
| `attachments.ts` | Private evidence upload (signature-checked, 8 MB), list, short-lived signed open link |
| `exports.ts` | Permission-scoped CSV exports with metadata and an audit row per export |
| `attendance.ts` | Daily roster, marking, maker-checker approval, labour cost estimate |
| `delegation.ts` | Time-limited delegation of authority (bundles of grants, `approval.self`), revoke, `mine` banner |
| `notify.ts` | `dispatchAlert` over Expo push, WhatsApp (WAHA / Evolution API / Cloud API) and SMS (android-sms-gateway / textbee) from env; device and preference procedures; `dispatchAlert` applies company `alert_rules` per category and role, personal `user_alert_mutes`, opt-ins and module switches (skips are logged); `alertRules`/`saveAlertRules` (leaders, audited), `myMutes`/`setMutes`, `recentDeliveries` (leaders) |
| `ai.ts` | Gemini bill scan and issue filling, Sarvam speech-to-text; keys from env only, per-user hourly limit |
| `presence.ts` | Site geofences for phones (staff by site access, workers by assignment), arrival/departure records with plausibility check, per-site rules (`site_presence_settings`: working hours and days in IST, alert on leave/arrive, chosen recipients or site leads) so alerts go only in working hours, phone-reported tracking status (`presence_tracking_status`) shown to site managers, presence log |
| `finance.ts` | Suppliers and invoices; mounts `supplier-payments.ts` and `petty-cash.ts` |
| `daily-reports.ts` | DPR work lines, report detail, `updateDraft` (writer corrects a draft or returned report), `progressContext` (last cumulative per task/work), `labourSnapshot`, linking attendance to a DLR on submit |
| `documents.ts` | Project documents: upload with versions (files are `attachments` rows with entityType `project_document`), list, detail, open, archive, hybrid smart search |
| `budgets.ts` | Project budgets: revisions per cost head, maker-checker approve/reject/withdraw, overview vs spend (approved bills by supplier type, approved attendance, posted petty cash; submitted items shown as waiting) |
| `profile.ts` | Own profile (designation, address, photo; mobile stays in contact preferences), `team` |
| `places.ts` | `placeCards` (cover photo + progress per site/project), schedule dashboard, `setCover` (`site.manage`) |
| `module-settings.ts` | Disabled modules per company (30 s cache); `getSiteScope` and `siteCapabilities` refuse/hide their permissions |
| `modules-router.ts` | Module list with 30-day usage, on/off by owner/director/admin, AI suggestion (never applied by itself) |
| `assistant.ts` | In-app assistant: answers from the person's data, one safe action (open screen / start draft), Sarvam TTS replies; up to 3 attached files per question (photos/PDF to Gemini, Word/Excel/CSV as text; not stored). `answerQuestion(user, …)` is shared with the WhatsApp bot |
| `document-index.ts` | After upload: text from Office/CSV (no AI) or Gemini reader (PDF/photo), passages, Gemini Embedding 2 vectors (768) when `GEMINI_API_KEY` is set; sets `indexStatus` |
| `people.ts` | People directory: `search`, `history` (sites, attendance and estimated earnings, rates, feedback, linked subcontractor firm bills/payments; each part limited by permission per site), `saveDetails`, append-only `addFeedback` (`workforce.manage`) |
| `whatsapp-bot.ts` | 24-hour WhatsApp bot: `POST /api/whatsapp/webhook` (mounted before the JSON parser; HMAC `X-OpenWA-Signature` with `OPENWA_WEBHOOK_SECRET`; on only with `WHATSAPP_BOT=on`). Staff matched by saved mobile get `answerQuestion` with their own permissions; strangers get one note a day and no data. Logs to `whatsapp_bot_messages` (dedupe by WhatsApp id). Setup: `scripts/setup-whatsapp-bot.sh` |
| `commercial-access.ts` | Company-level access for CRM and billing: leader-first membership role, organisation grants, module switch, projects visible through the caller's sites |
| `crm.ts` | `jp.crm`: clients, enquiries (leads) with stages and follow-ups, quotations (server-numbered QT-YYYY-NNNN, exact GST totals); accepting a quotation wins its enquiry |
| `billing.ts` | `jp.billing`: project contract (client, GST/retention/TDS), contract items (client BOQ, also from an accepted quotation), RA bills (cumulative quantity checked, maker-checker), receipts and reversals, receivables with ageing |
| `system-check.ts` | `jp.systemCheck.run` (leaders): real calls to Gemini text, Gemini picture reading, Sarvam TTS → STT, storage, embeddings, WhatsApp config, with the provider's reason on failure; `voice` tests the phone's microphone |
| `purchase.ts` | `jp.purchase` (site scoped, `purchase.*`): POs with competing quotes (server-numbered PO-SITE-NNN, GST per line), maker-checker approve/reject/close, goods receipts (GRN-SITE-NNN) with rejection reasons that send accepted catalogue material to the inventory ledger as Submitted Receipt/Inward, supplier bill matching (received value at PO rates vs linked bills); POs awaiting approval appear in the inbox |
| `subcontract.ts` | `jp.subcontract` (site scoped, `subcontract.*`): work orders to Subcontractor-type firms (WO-SITE-NNN, own BOQ, GST/retention/TDS, mobilisation advance with % recovery), measurement book (nos × L × B × D, deductions, never past the WO quantity; checked or rejected by a different person), RA bills (`WO…/RA-NN`) only from checked unbilled measurements, retention release after close. Approving a WO with an advance, an RA bill, or a retention release writes an Approved `supplier_invoices` row (deductions as negative charges, total = net payable) so it is paid through supplier payments. WOs/bills awaiting approval and measurements to check appear in the inbox |
| `payroll.ts` | `jp.payroll` (site scoped, `payroll.*`): company rates with an effective date (`payroll_settings`; standard rates until accounts saves its own), payroll profiles per person (Daily from attendance or Monthly salary, PF/ESI/PT membership, UAN/ESI no.) approved by a different person, monthly pay runs (PR-SITE-YYYYMM, one per site and month) built from approved attendance (overtime at the multiplier) and profiles, with manual paid days/TDS/advance/other deduction per line, refresh from attendance, maker-checker submit/approve/return/cancel (submit blocked while the month has unapproved attendance), and `markPaid` (ledger record only). Rates are snapshotted on the run |
| `books.ts` | `jp.books` (company level via `commercialAccess`, `accounts.*`): statutory dues from approved payroll (PF, ESI, PT, salary TDS by pay month) and approved subcontract bills (contractor TDS by bill month) against recorded deposits with challan (reversible with a reason), due dates and overdue state, GST by month (output on approved client bills, input on approved supplier bills), receivables/payables, project profit (work value less supplier subtotals by vendor type, payroll cost, posted petty cash; approved attendance not yet in a pay run shown apart). Overdue dues appear in the inbox. Named `books` because `accounts.ts` is user account administration |
| `advances.ts` | `jp.advances` (site scoped): worker khaata. Advances and cash repayments (`worker_advances`) requested with `payroll.advance` (supervisors too) and approved by a different person with `payroll.approve`; per-person position (paid, approved unpaid, attendance not yet in a pay run, advance outstanding). Wage figures need `payroll.view`; advance-only users see the advance columns. Pay runs recover advances: the installment is suggested, capped at what is still recoverable (other open runs counted), lowered when pay is low, and a manual deduction above it is refused. Pending advances show in the inbox |
| `user-access.ts` | `jp.userAccess` (`user.manage`, above the target in the hierarchy, never yourself, never an owner): per-user On/Off/role-default for any permission for the whole company or one site, as lasting `permission_grants` (reason "Access: …"; delegation grants are left alone). Only an owner switches on what they do not hold; `approval.self` is not offered; company-level keys (crm, billing, accounts, user.manage) only for all sites. Audited as `access.set` |
| `reports.ts` | `jp.feedback` + `auth.workerForgotPin`: problem reports in `app_reports` (no foreign keys, so a report is never lost). Forgot PIN (public, same answer for every number, once per 6 h, tells site leads; closed when `setLogin` sets a new PIN), worker "something is wrong" (`jp.worker.reportProblem`, needs the `help` feature), staff `send`, `appError` from phones (public, repeats within 10 min counted on one row, 30/h per phone). `list`/`resolve`: leaders see all (plus pre-sign-in errors), site managers with `workforce.review` see worker requests on their sites. Open worker requests show in the inbox as `worker.help` |
| `tracking.ts` | `jp.tracking.overview` (read only): one month per person for sites where the caller holds `workforce.review` — workers' attendance (days in halves, hours, overtime, marks waiting for approval), presence from phones, and wages/advances only where `payroll.view` is held; staff reports and presence |
| `crews.ts` | `jp.crews` (site scoped): trade-wise teams. `list` (`workforce.view`; cost per crew from approved attendance only with `payroll.view`), `create`/`addMember`/`removeMember`/`close`/`deploy` (`workforce.manage`, Active site). One open crew per worker per site, checked under a row lock; membership keeps joined/left dates |
| `worker.ts` | `jp.worker`: the mistri/labour app. Workers sign in with mobile + 6-digit PIN (`auth.workerLogin`, `worker_accounts`, scrypt hash, 5 wrong PINs lock 30 min, same answer for unknown numbers) and get a user row with a random never-shared password and no company membership, so every other procedure refuses them. `me` returns only switched-on features (money, attendance, drawings of their sites, supervisor phone); `viewFor`/`openDrawingFor` show it on a supervisor's phone (`workforce.view`); `account`/`setLogin`/`update` need `workforce.review` (managers and leaders). Disabling a login revokes its sessions |

## Conventions

- Start every procedure with `protectedProcedure` and call `getSiteScope(ctx.user, siteId, "<permission.key>")` before touching data. Keys ending in `.view` are read only and still work on inactive sites; any other key requires an Active site.
- A new permission key goes in `permissionKeys` in `capabilities.ts` and in the role mapping in `policy.ts`, so the client capabilities stay in sync.
- Throw `TRPCError` with a plain, user readable message. Use `PRECONDITION_FAILED` when the database is unavailable (`requireDb`).
- Mutations take `clientMutationId` (16 to 64 chars). On retry, look up the prior `auditEvents` row by actor and mutation id and return the same result instead of writing twice.
- Changes that touch several rows run in `db.transaction`, lock the rows they check with `.for("update")`, and insert an `auditEvents` row (action, entity, before and after summary, reason).
- Status transitions are maker checker: a different user reviews, and rejections or cancellations need a reason. The server sets the final status.
- Keep pure rules in `lib/jp/` so they can be unit tested without a database.

## Gotchas

- Maker-checker checks call `selfApprovalAllowed` (from `access.ts`): the same person may approve their own record only while a delegation grants `approval.self` for that site.
- CRM and billing events are company level (`siteId` null); `workspace.auditEvents` shows them to owner, director, admin and auditor.
- Gemini answers 503 "high demand" often. `geminiJson` retries each model once, then tries `GEMINI_FALLBACK_MODELS` (default `gemini-flash-latest,gemini-2.5-flash`); `aiJson` then falls back to Sarvam for text-only requests. Failed requests are logged by `onError` in `server/_core/index.ts` (procedure and reason, never input). `scripts/check-ai.sh` checks the live server.
- Alerts are best effort and never throw; they run after the transaction commits.
- A procedure that checks the site with a core key (`site.view`) and resolves the real permission itself must call `assertModuleOn(organizationId, key)`, or a turned-off module still works (this was the workforce and petty-cash acknowledge bug).

- The database has no CHECK constraints. Positive amounts, date ordering, and non negative balances are enforced only here; do not claim the database enforces them.
- Supplier payment posting and petty cash entries are app ledger events, not bank transfers.
- Petty cash Expense entries require the site fund attestation; Personal Funds are rejected until the reimbursement workflow exists. Task labels on cash movements are snapshots, so later task edits do not rewrite history.
- Tests here (`policy.test.ts`) are database free. Do not write tests that hit the shared database.

## Agent skills

- [zod](../../.claude/skills/zod/): `pproenca/dot-skills`, Zod input schemas and validation

Declined: none. tRPC: no installable Agent Skill was found at install time (`trpc/trpc` had no valid SKILL.md).

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
