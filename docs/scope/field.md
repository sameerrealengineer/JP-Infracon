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
Drafts and submission are persisted. Still open: reviewer approve or return with visible revisions, and the full PRD fields (shift, weather, safety notes, planned and completed quantities, blockers, next day plan, optional GPS with consent).
**Done when:** a supervisor submits a complete DPR, a reviewer approves or returns it with a reason, and every revision stays visible with who and when.
- [ ] Design it (spec): `/architect daily reports (DPR/DLR)`
code in `server/jp/router.ts`, `app/(tabs)/reports.tsx`

### 15. Report photo evidence · needs a decision
Attach private photos to daily reports using feature 12, captured offline and kept on the phone until upload is confirmed.
**Done when:** a supervisor attaches photos to a DPR offline, they upload when online, and only users with access to that site can view them.
- [ ] Design it (spec): `/architect report photo evidence`

### 16. Attendance & overtime · needs a decision
Full day, half day, absent, leave, and hours based attendance with overtime, duplicate prevention, traceable corrections, and the rate in effect on that day.
**Done when:** a supervisor records attendance once per worker per day, corrections keep history, missing rates and unapproved overtime are flagged, and estimated cost is never shown as a payable.
- [ ] Design it (spec): `/architect attendance & overtime`

### 17. Material requests · in-progress
Persisted material requests exist. Still open: partial approval, return, rejection, cancellation, and linking receipts and partial or rejected deliveries to stock.
**Done when:** a reviewer can approve part of a request with a reason, a delivery against it posts accepted quantity only, and rejected goods never reach stock.
- [ ] Design it (spec): `/architect material requests`
code in `server/jp/router.ts`, `app/(tabs)/requests.tsx`

## Slice 2: Worker pay

### 24. Vendors & subcontractors · needs a decision
Vendor and subcontractor records with engagements, normalised and site or project scoped, without collecting bank credentials.
**Done when:** an authorised user can add a subcontractor, engage them on a site, and see their engagement history.
- [ ] Design it (spec): `/architect vendors & subcontractors`

### 25. Subcontract work measurements · needs a decision
Record measured work for subcontractors, kept separate from attendance so the same work is not paid twice.
**Done when:** a measurement is recorded and approved against an engagement and rate, and the same work cannot also earn through attendance unless explicitly allowed.
- [ ] Design it (spec): `/architect subcontract work measurements`

## Slice 3: Supplier and stock depth

### 32. Stock transfers, counts & adjustments · needs a decision
Linked transfers between sites, physical counts with variance approval, approved unit conversions, and corrections by linked reversal, never deletion.
**Done when:** a transfer moves stock out of one site and into another as linked entries, a count variance needs a reason and approval, and history pages through every movement.
- [ ] Design it (spec): `/architect stock transfers, counts & adjustments`

## Slice 4: Site issues and schedule depth

### 33. Safety, quality & constraint issues · needs a decision
Record hazards, incidents, near misses, defects, shortages, and access or drawing constraints with severity, owner, target date, evidence, corrective action, and full status history.
**Done when:** a supervisor raises an issue with a photo, an owner closes it with closure evidence, and reopening needs a reason. The app never certifies a hazard safe.
- [ ] Design it (spec): `/architect safety, quality & constraint issues`

### 35. Work calendars & resource conflicts · needs a decision
Add work calendars, date conflicts, affected resource assignments, and optional approval to rescheduling.
**Done when:** a reschedule preview shows non working days and resource clashes, and a configured approval gates the change.
- [ ] Design it (spec): `/architect work calendars & resource conflicts`

## Slice 5: Reports

### 36. Home & director dashboards · in-progress
The supervisor home and sites views show live records. Still open: the full director dashboard (progress, overdue tasks, report status, manpower, issues, low stock, cash balances, dues), each with its filter, date range, and refresh time.
**Done when:** a director sees every PRD dashboard figure from persisted records with the filter and last update shown, and empty periods say so plainly.
- [ ] Design it (spec): `/architect home & director dashboards`
code in `app/(tabs)/index.tsx`, `app/(tabs)/sites.tsx`

### 37. Exports (CSV and PDF) · needs a decision
Exports for reports, attendance, schedule, stock, worker and supplier ledgers, petty cash, issues, and audit, each with organisation, site, filter range, generated time, and continuation markers.
**Done when:** each listed export downloads for an authorised user, CSV escapes untrusted text, and PDF prints cleanly.
- [ ] Design it (spec): `/architect exports (CSV and PDF)`
