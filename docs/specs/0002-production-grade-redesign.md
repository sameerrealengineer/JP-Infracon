# 0002 — Production-grade redesign (A-Class works contractor)

Status: all 7 phases built (18 Nov 2026). Data on the live server was wiped on 18 Nov 2026 at the
user's request (backup `~/backups/jp-2026-11-17.sql.gz`, files archive
`~/backups/files-before-reset-2026-11-18.tar.gz`). No seed, demo or sample data goes onto the
live server from now on.

## Why

The client (an A-Class government works contractor in Odisha: buildings, water supply O&M,
tanks) finds the app confusing and "dummy-like": many modules, office-style forms, little that
matches how a site and a PWD/RWSS contract actually run. The goal is software at the level of
the big construction ERPs, but simple on a phone.

## What the market does (research, Nov 2026)

- Indian contractor ERPs (Farvision, Prime ERP, eresource Nfra, MBook, NWAY) are built around
  **tender → contract → measurement book → RA bill → final bill**: NIT/EMD/BG registers,
  awarded BOQ becomes the budget, MB entries (nos × L × B × D) signed jointly with the
  department engineer, RA bills in the department's format, retention/BG ledgers, TDS 194C,
  GST, BOCW cess. Unsigned MB entries are not a payment basis.
- Field apps (Procore, Autodesk Build, Fieldwire, Powerplay) win on the **daily log** (weather,
  crew, equipment, notes, photos), punch lists/inspections, drawings on the phone, and a
  **role-based home** ("my day" for the foreman, schedule for the PM). Powerplay grew in India
  by being mobile-first and vernacular (labour, tasks, material, payments).
- Plant & machinery apps (TappetBox, ZYNO) track **logsheets** (running/idle hours), **fuel
  issued vs the norm per machine**, hire charges per activity, downtime and service.
- Government contract registers (CPWD/State PWD forms): cement register, materials & works
  test register, hindrance register (basis for extension of time), register of works.
- UX consensus: offline that never loses data, role-based home, fast one-handed forms, no
  training needed, only the features the role uses.

## Where JP Infracon stands

Already strong: server-side RBAC and scope, maker-checker, exact paise, audit trail, offline
drafts, DPR/DLR, attendance, workforce, payroll/advances, petty cash, supplier bills and
payments, purchase, stores, subcontract MB + RA bills, client RA billing, budgets, documents with
AI search, analytics, civil tools, WhatsApp, step-by-step mode, Hindi/Odia.

Gaps against the market for this client:

| Gap | Why it matters |
|---|---|
| Tender & bid register (NIT, EMD, BG, validity, results) | Every A-Class job starts here; EMD/BG money is locked and expires |
| Contract register (agreement, SD, performance guarantee, time extensions, defect liability) | BG/PG expiry and SD release are real money |
| Department MB with joint sign-off feeding the RA bill to the department | Today client billing is BOQ-based; govt pays only on signed MB |
| Hindrance register + extension of time | Protects against LD/penalty |
| Cement & steel reconciliation (theoretical from work done vs issued/consumed) | Department and audit check this; leakage control |
| Quality test register (cube 7/28-day due dates, slump, steel, bricks) | Mandatory, and missed tests block bills |
| Plant & machinery (owned/hired, logsheet, fuel vs norm, hire bills, service) | Big cost line, no control today |
| One "site diary" instead of separate DPR/DLR/photo/hindrance screens | What the site team actually fills daily |
| UI: office-style screens, too many menus | The client's main complaint |

## The new experience (UI/UX)

- **Shell:** five bottom tabs — **Today**, **Projects**, **＋ Capture**, **Money**, **More**.
- **Today (role-based):** the only list a person needs this morning: their approvals, tasks due,
  today's diary status, low stock, expiring BG/tests, money waiting. Engineers/supervisors see
  their site; leaders see the company.
- **＋ Capture:** one big button for the 6 things done on site: attendance, site diary, photo,
  material in/out, expense, issue. Two taps, works offline.
- **Projects → Project hub → Site:** everything about a job in one place (contract, BOQ & MB,
  bills, schedule, money, documents, team), instead of separate module menus.
- **Design:** 48 dp targets, one primary action per screen, cards with status colour + icon +
  word (never colour alone), sticky bottom action bar on forms, skeleton loading, honest offline
  badge, same layout on web (centred column on wide screens). Hindi/Odia first-class.
- Step-by-step mode stays: new companies start with Today + Capture + Projects, and modules
  open as they are used.

## Phases (each ships end to end: schema, server rules, screens, tests, APK + web)

1. **New shell and Today** — tabs, role-based Today, Capture sheet, Project hub; existing
   features re-homed (no feature loss). Visual refresh of the shared components.
2. **Site diary** — one daily entry: weather, work done (BOQ items/tasks), labour (from
   attendance), equipment, material used, hindrances, photos, visitors; produces the DPR/DLR.
3. **Tender, contract & guarantees** — tender register (NIT, EMD, result), contract register
   (agreement, SD, PG/BG with expiry alerts, EOT, DLP), guarantee/EMD money tracked.
4. **Department MB & RA bill** — MB entries against contract BOQ with joint sign-off (contractor
   + department engineer name/date/photo of signed page), RA bill to department from signed MB
   only, deductions (SD, IT TDS, GST TDS, cess), receipts.
5. **Quality & materials control** — test register (cube casting → 7/28-day due alerts and
   results, slump, steel, bricks), cement/steel reconciliation against standard consumption.
6. **Plant & machinery** — equipment register (owned/hired), daily logsheet, fuel issue vs
   norm, hire bills, service schedule.
7. **Money control** — cash-flow forecast (bills due in/out), project P&L live, approvals centre.

## Rules kept

Server authority, exact paise, maker-checker, audit, idempotency, offline drafts never shown as
approved, no bank execution, translations through `useT()`, no sample data on the live server.
