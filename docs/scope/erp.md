# Epic: ERP & admin

Commercial, payroll, and company tools built in November 2026 on top of the field loop: client billing, payroll and statutory dues, the worker app, crews, documents, budgets, presence, access, AI, and admin. Every money entry is an internal ledger record, never a bank or UPI transfer. Part of the [JP Infracon scope](index.md).

## Built ahead of the plan

These were built and deployed before this scope listed them. Each is in progress until it is verified against its `Done when` line.

### 39. CRM & client billing · in-progress · GA
Clients, enquiries with stages and follow ups, quotations (QT numbers, exact GST), project contracts with client BOQ, RA bills with cumulative quantity checks and maker checker, receipts, reversals, and receivables with ageing.
**Done when:** an enquiry becomes a won quotation and a contract, an RA bill is approved by a different person, a receipt settles it, and receivables age correctly.
- [x] Build the first version (shipped before a spec; see `TODO.md` ERP slice 1)
- [ ] Verify it: `/check verify crm & client billing`
- [ ] Design the open items (spec): `/architect crm & client billing`
- [ ] Test it: `/test crm & client billing`
- [ ] Review and document it: `/check review crm & client billing`, then `/document`
code in `server/jp/crm.ts`, `server/jp/billing.ts`, `lib/jp/billing-domain.ts`, `app/crm.tsx`, `app/billing.tsx`

### 40. Payroll & statutory accounts · in-progress · GA
Pay runs per site from approved attendance and salary profiles, dated statutory rates, payslips, PF ECR and ESIC files, and company accounts: PF, ESI, PT and TDS dues against challans, GST by month, and project profit. Still open: salary TDS computation (entered by hand), Form 24Q, ESI period locking, and a CA review of the rates before the first real pay run.
**Done when:** a month's pay run builds from approved attendance, is approved by a different person, its dues show against recorded challans, and a CA has checked the rates.
- [x] Build the first version (shipped before a spec; see `TODO.md` increment 5 November)
- [ ] Verify it: `/check verify payroll & statutory accounts`
- [ ] Design the open items (spec): `/architect payroll & statutory accounts`
- [ ] Test it: `/test payroll & statutory accounts`
- [ ] Review and document it: `/check review payroll & statutory accounts`, then `/document`
code in `server/jp/payroll.ts`, `server/jp/books.ts`, `lib/jp/payroll-domain.ts`, `lib/jp/accounts-domain.ts`, `app/payroll.tsx`

### 41. Mistri worker app · in-progress
Workers sign in with mobile and a 6 digit PIN (locked after 5 wrong tries, forgot PIN tells site leads) and see a big tile screen with only switched on features (money, attendance, drawings, call supervisor), read aloud in English, Hindi or Odia; also shown on a supervisor's phone. Still open: a field test with real workers and a native speaker review.
**Done when:** a worker with a basic Android phone signs in, hears their attendance and money read aloud, and reports a problem, with no access to any other data.
- [x] Build the first version (shipped before a spec; see `TODO.md` increments 5 November (b) and 1.5.0)
- [ ] Verify it: `/check verify mistri worker app`
- [ ] Design the open items (spec): `/architect mistri worker app`
- [ ] Test it: `/test mistri worker app`
code in `server/jp/worker.ts`, `lib/jp/worker-app.ts`, `components/jp/worker-home.tsx`

### 42. Crews, task assignment & team tracking · in-progress
Trade wise crews with member history, daily work per task and labour cost from approved attendance; tasks assigned to a person and a crew; a monthly team tracking view of attendance, presence, reports and (with payroll rights) wages.
**Done when:** a site manager forms a crew, assigns a task to a person and crew, and sees each person's month in team tracking with wages only for payroll roles.
- [x] Build the first version (shipped before a spec; see `TODO.md` increment 6 November)
- [ ] Verify it: `/check verify crews, task assignment & team tracking`
- [ ] Design the open items (spec): `/architect crews, task assignment & team tracking`
- [ ] Test it: `/test crews, task assignment & team tracking`
code in `server/jp/crews.ts`, `server/jp/tracking.ts`, `lib/jp/crew-domain.ts`, `app/crews.tsx`, `app/tracking.tsx`

### 43. Project documents & smart search · in-progress
Project documents with versions, categories, archive, text extraction (Office and CSV without AI, PDF and photos through Gemini) and hybrid keyword plus meaning search.
**Done when:** a user uploads a new version of a drawing, finds it by searching words inside it, and only people with access to that project can open it.
- [x] Build the first version (shipped before a spec; see `TODO.md` increments 3 and 4 November)
- [ ] Verify it: `/check verify project documents & smart search`
- [ ] Design the open items (spec): `/architect project documents & smart search`
- [ ] Test it: `/test project documents & smart search`
code in `server/jp/documents.ts`, `server/jp/document-index.ts`, `lib/jp/document-policy.ts`, `app/documents.tsx`

### 44. Project budgets · in-progress · GA
Budget revisions per cost head with maker checker approval, compared with approved spend (supplier bills by type, approved attendance, posted petty cash) and waiting items shown apart.
**Done when:** a budget revision is approved by a different person, and the overview shows each head as ok, near or over from approved spend only.
- [x] Build the first version (shipped before a spec; see `TODO.md` increment 3 November)
- [ ] Verify it: `/check verify project budgets`
- [ ] Design the open items (spec): `/architect project budgets`
- [ ] Test it: `/test project budgets`
- [ ] Review and document it: `/check review project budgets`, then `/document`
code in `server/jp/budgets.ts`, `lib/jp/budget-domain.ts`, `app/project-budget.tsx`

### 45. Site presence & GPS alerts · in-progress
Site boundaries, opt in phone geofencing with plausibility checks, per site working hours and days in IST, and arrival or departure alerts only in working hours to chosen people; tracking status visible to site managers. Tracking can never be forced on a phone. Still open: a field test on real phones.
**Done when:** a worker leaving the site during working hours alerts the chosen people, nothing is sent out of hours, and managers see whose tracking is off.
- [x] Build the first version (shipped before a spec; see `TODO.md` increments 2 November (c) and 5 November (b))
- [ ] Verify it: `/check verify site presence & gps alerts`
- [ ] Design the open items (spec): `/architect site presence & gps alerts`
- [ ] Test it: `/test site presence & gps alerts`
code in `server/jp/presence.ts`, `lib/jp/presence-rules.ts`, `lib/geofence-task.ts`, `app/site-presence.tsx`

### 46. Delegation & per user access · in-progress · GA
Time limited delegation of site or project authority with immediate revoke, and per user On or Off switches for any module or action, for all sites or one, enforced by the server and audited.
**Done when:** a director delegates approval for a week and revokes it early, an admin switches one action off for one user on one site, and the server refuses it at once.
- [x] Build the first version (shipped before a spec; see `TODO.md` increments 2 November (c) and 5 November (b))
- [ ] Verify it: `/check verify delegation & per user access`
- [ ] Design the open items (spec): `/architect delegation & per user access`
- [ ] Test it: `/test delegation & per user access`
- [ ] Review and document it: `/check review delegation & per user access`, then `/document`
code in `server/jp/delegation.ts`, `server/jp/user-access.ts`, `lib/jp/access-catalog.ts`, `app/user-access.tsx`

### 47. AI assistant, voice & WhatsApp bot · in-progress
An in app assistant that answers from the person's own data and can open a screen or start a draft, live voice talk, AI fill for reports, bills, issues, requests and expenses, and a 24 hour WhatsApp bot for staff with saved mobiles. AI output is re-checked and never saved without confirmation. Still open: measuring AI response time on the live server.
**Done when:** a supervisor asks a question by voice in Odia and gets an answer limited to their permissions, and a stranger messaging the bot gets no data.
- [x] Build the first version (shipped before a spec; see `TODO.md` increments 2 to 6 November)
- [ ] Verify it: `/check verify ai assistant, voice & whatsapp bot`
- [ ] Design the open items (spec): `/architect ai assistant, voice & whatsapp bot`
- [ ] Test it: `/test ai assistant, voice & whatsapp bot`
code in `server/jp/assistant.ts`, `server/jp/ai.ts`, `server/jp/whatsapp-bot.ts`, `app/assistant.tsx`

### 48. Company admin & help · in-progress
Module switches per company, the people directory with history and feedback, profiles and photos, the project page, the help guide with a help button on main screens, App problems, and a system check of AI, storage and WhatsApp. Still open: help text in Hindi and Odia.
**Done when:** an owner turns a module off and it disappears and is refused everywhere, and a new user finds their first steps in the help guide.
- [x] Build the first version (shipped before a spec; see `TODO.md` increments 3 to 6 November)
- [ ] Verify it: `/check verify company admin & help`
- [ ] Design the open items (spec): `/architect company admin & help`
- [ ] Test it: `/test company admin & help`
code in `server/jp/module-settings.ts`, `server/jp/people.ts`, `server/jp/places.ts`, `lib/jp/help-content.ts`, `app/modules.tsx`, `app/help.tsx`
