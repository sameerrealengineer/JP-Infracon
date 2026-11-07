# Epic: Field operations

Daily reports, attendance, materials, schedule, workforce, inventory, issues, dashboards, and exports. Part of the [JP Infracon scope](index.md).

## Existing

### 4. Tasks & schedule revisions · existing
Site scoped tasks, Finish to Start dependencies, audited status changes, reasoned reschedule with impact preview and confirmation, immutable schedule history. Work calendars and resource conflicts are planned in feature 35. code in `server/jp/tasks.ts`, `lib/jp/scheduling.ts`, `app/schedule.tsx`

### 5. Workforce register, KYC status & rates · existing
Site scoped worker, technician, and contact records with minimal personal data, manual KYC status review, effective dated rates with history. Vendors, measurements, and pay are planned in features 24 to 27. code in `server/jp/workforce.ts`, `lib/jp/workforce-domain.ts`, `app/workforce.tsx`

### 6. Inventory ledger · existing
Organisation catalogue in base units, review gated inward, issue, return, and wastage entries, stock derived from posted movements, negative stock blocked under row locks. Transfers and counts are planned in feature 32. code in `server/jp/inventory.ts`, `lib/jp/inventory-domain.ts`, `app/inventory.tsx`

## Slice 1: First field release

### 14. Daily reports (DPR/DLR) · in-progress
Drafts, submission, DPR work lines, report detail, correcting a returned report, the labour report linked to attendance, and AI fill by voice or text are built. Still open: check reviewer approve or return with visible revisions, and the remaining PRD fields (weather, safety notes, blockers, next day plan, optional GPS with consent).
**Done when:** a supervisor submits a complete DPR, a reviewer approves or returns it with a reason, and every revision stays visible with who and when.
- [x] Build the first version (shipped before a spec; see `TODO.md` increments 2 to 6 November)
- [ ] Verify it: `/check verify daily reports (dpr/dlr)`
- [ ] Design the open items (spec): `/architect daily reports (dpr/dlr)`
- [ ] Test it: `/test daily reports (dpr/dlr)`
code in `server/jp/router.ts`, `server/jp/daily-reports.ts`, `lib/jp/dpr-domain.ts`, `app/report-editor.tsx`

### 15. Report photo evidence · in-progress
Private photos attach to daily reports through feature 12, with GPS stamped camera photos. Still open: capturing photos offline and keeping them on the phone until upload is confirmed.
**Done when:** a supervisor attaches photos to a DPR offline, they upload when online, and only users with access to that site can view them.
- [x] Build the first version (shipped before a spec; see `TODO.md` increments 2 November (b) and (c))
- [ ] Verify it: `/check verify report photo evidence`
- [ ] Design the open items (spec): `/architect report photo evidence`
- [ ] Test it: `/test report photo evidence`
code in `server/jp/attachments.ts`, `components/jp/attachment-strip.tsx`

### 16. Attendance & overtime · in-progress
Daily roster and marking, approval by a different person, overtime held until approved, approved rows locked, and labour cost split into approved and estimated. Still open: check duplicate prevention and traceable corrections against the PRD.
**Done when:** a supervisor records attendance once per worker per day, corrections keep history, missing rates and unapproved overtime are flagged, and estimated cost is never shown as a payable.
- [x] Build the first version (shipped before a spec; see `TODO.md` increment 2 November (b))
- [ ] Verify it: `/check verify attendance & overtime`
- [ ] Design the open items (spec): `/architect attendance & overtime`
- [ ] Test it: `/test attendance & overtime`
code in `server/jp/attendance.ts`, `lib/jp/attendance-domain.ts`, `app/attendance.tsx`

### 17. Material requests · in-progress
Persisted material requests with AI fill exist, and purchase orders with goods receipts now post accepted material to stock (feature 29). Still open: partial approval, return, rejection and cancellation of the request itself.
**Done when:** a reviewer can approve part of a request with a reason, a delivery against it posts accepted quantity only, and rejected goods never reach stock.
- [x] Build the first version (shipped before a spec; see `TODO.md` increments 2 to 6 November)
- [ ] Verify it: `/check verify material requests`
- [ ] Design the open items (spec): `/architect material requests`
- [ ] Test it: `/test material requests`
code in `server/jp/router.ts`, `app/(tabs)/requests.tsx`, `app/site-requests.tsx`

## Slice 2: Worker pay

### 24. Vendors & subcontractors · in-progress
Subcontractor type firms take work orders with their own BOQ, GST, retention, TDS and mobilisation advance. Still open: check engagement history per subcontractor without collecting bank credentials.
**Done when:** an authorised user can add a subcontractor, engage them on a site, and see their engagement history.
- [x] Build the first version (shipped before a spec; see `TODO.md` ERP slice 3)
- [ ] Verify it: `/check verify vendors & subcontractors`
- [ ] Design the open items (spec): `/architect vendors & subcontractors`
- [ ] Test it: `/test vendors & subcontractors`
code in `server/jp/subcontract.ts`, `lib/jp/subcontract-domain.ts`, `app/subcontract.tsx`

### 25. Subcontract work measurements · in-progress
Measurement book (nos × L × B × D with deductions, never past the work order quantity), checked by a different person, and RA bills only from checked unbilled measurements. Still open: the rule that the same work cannot also earn through attendance.
**Done when:** a measurement is recorded and approved against an engagement and rate, and the same work cannot also earn through attendance unless explicitly allowed.
- [x] Build the first version (shipped before a spec; see `TODO.md` ERP slice 3)
- [ ] Verify it: `/check verify subcontract work measurements`
- [ ] Design the open items (spec): `/architect subcontract work measurements`
- [ ] Test it: `/test subcontract work measurements`
code in `server/jp/subcontract.ts`, `app/work-order.tsx`, `app/sub-bill.tsx`

## Slice 3: Supplier and stock depth

### 32. Stock transfers, counts & adjustments · needs a decision
Linked transfers between sites, physical counts with variance approval, approved unit conversions, and corrections by linked reversal, never deletion.
**Done when:** a transfer moves stock out of one site and into another as linked entries, a count variance needs a reason and approval, and history pages through every movement.
- [ ] Design it (spec): `/architect stock transfers, counts & adjustments`

## Slice 4: Site issues and schedule depth

### 33. Safety, quality & constraint issues · in-progress
Report, assign, start, resolve, verify and close (High and Critical closed by a different person), send back, reopen with a reason, history, comments, evidence, offline drafts and inbox items. Still open: escalation (feature 34) and device testing.
**Done when:** a supervisor raises an issue with a photo, an owner closes it with closure evidence, and reopening needs a reason. The app never certifies a hazard safe.
- [x] Build the first version (shipped before a spec; see `TODO.md` increment 2 November (b))
- [ ] Verify it: `/check verify safety, quality & constraint issues`
- [ ] Design the open items (spec): `/architect safety, quality & constraint issues`
- [ ] Test it: `/test safety, quality & constraint issues`
code in `server/jp/issues.ts`, `lib/jp/issue-policy.ts`, `app/issues.tsx`

### 35. Work calendars & resource conflicts · needs a decision
Add work calendars, date conflicts, affected resource assignments, and optional approval to rescheduling.
**Done when:** a reschedule preview shows non working days and resource clashes, and a configured approval gates the change.
- [ ] Design it (spec): `/architect work calendars & resource conflicts`

## Slice 5: Reports

### 36. Home & director dashboards · in-progress
Home, sites, schedule dashboard, progress health, the project page and team tracking show live records. Still open: check every PRD director figure (manpower, low stock, cash balances, dues) with its filter, date range and refresh time.
**Done when:** a director sees every PRD dashboard figure from persisted records with the filter and last update shown, and empty periods say so plainly.
- [x] Build the first version (shipped before a spec; see `TODO.md` increments 2 to 6 November)
- [ ] Verify it: `/check verify home & director dashboards`
- [ ] Design the open items (spec): `/architect home & director dashboards`
- [ ] Test it: `/test home & director dashboards`
code in `app/(tabs)/index.tsx`, `server/jp/places.ts`, `components/jp/schedule-dashboard.tsx`

### 37. Exports (CSV and PDF) · in-progress
Permission scoped CSV exports (formula safe, with metadata and a continuation note past 5000 rows, each audited) and printable PDF. Still open: attendance and worker ledger exports, if not yet covered.
**Done when:** each listed export downloads for an authorised user, CSV escapes untrusted text, and PDF prints cleanly.
- [x] Build the first version (shipped before a spec; see `TODO.md` increments 2 November (b) and (c))
- [ ] Verify it: `/check verify exports (csv and pdf)`
- [ ] Design the open items (spec): `/architect exports (csv and pdf)`
- [ ] Test it: `/test exports (csv and pdf)`
code in `server/jp/exports.ts`, `lib/jp/csv.ts`, `lib/jp/pdf-report.ts`, `app/exports.tsx`
