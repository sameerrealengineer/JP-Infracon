# JP Infracon — Construction & Infrastructure Management Android App

**Document type:** Product Requirements Document (PRD) + implementation specification  
**Version:** 1.0  
**Date:** 26 October 2026  
**Status:** Ready for implementation planning  
**Primary platform:** Native Android application  
**Target organisation:** JP Infracon  
**Primary users:** Company directors/admins, project managers, site supervisors/engineers, accounts/store staff, and authorised read-only reviewers

> **Important validation note:** This document corrects the source concept into a more implementable product specification. Live internet research was unavailable while preparing it, so this is a technical and product-design validation—not a claim that current laws, government tender rules, Aadhaar requirements, tax rules, or accounting standards have been externally verified. Before production, the company must have its accountant and legal/compliance adviser validate statutory, payroll, document-retention, privacy, and tax requirements for its operating locations.

---

## 1. Product Vision

Build a real, auditable Android application that allows JP Infracon to manage construction projects and multiple independent sites from one place. The application must replace scattered WhatsApp messages, paper registers, photo folders, manual attendance calculations, stock notebooks, and informal payment records with structured workflows and traceable records.

The app is not merely a dashboard or a clickable prototype. Core actions must save to a real backend, enforce permissions on the server, maintain an audit trail, handle poor network connectivity, and produce accurate reports from persisted records.

### 1.1 Business outcomes

1. Directors can see current progress, delayed tasks, manpower, stock, expenditure, and pending dues across all authorised sites.
2. Site supervisors can submit DPR/DLR, request materials, record receipts/consumption, report safety and quality issues, plan work, and record authorised expenses from an Android phone.
3. Accounts staff can reconcile supplier bills, worker payouts, petty cash, advances, and reimbursements without double counting transactions.
4. Every important record shows who created it, when it was created, who changed/approved it, and the reason for a material change.
5. The system continues to capture permitted field entries offline and synchronises them safely when connectivity returns.
6. Directors can delegate limited authority to a supervisor—for example, purchasing up to a specific amount—without giving that supervisor unrestricted financial access.

### 1.2 Product principles

- **Real data first:** no fake dashboard metrics or hardcoded success actions in production builds.
- **Site-scoped access:** a supervisor sees only assigned sites and permitted records.
- **Server-enforced permissions:** hiding a button in the UI is not sufficient authorisation.
- **Ledger-based accounting:** balances are calculated from posted transactions, not manually editable totals.
- **Append-only audit history:** important financial and operational changes must remain traceable.
- **Offline-aware:** users can save approved offline-capable drafts; sensitive actions that require server validation must wait for connectivity.
- **Evidence over unsupported claims:** GPS and timestamps are supporting evidence of a report event, not proof that a person was physically present or that a photo is genuine.
- **Configurable workflow:** approval thresholds, required attachments, report fields, and project categories should be configurable by authorised admins where practical.

---

## 2. Scope

### 2.1 MVP — required for the first production release

1. Sign-in, session management, user invitation/onboarding, role and site assignment.
2. Organisation, project, and site master data.
3. Dynamic, site-scoped permissions and approval limits.
4. Site calendar, tasks, dependencies, rescheduling, and delay reasons.
5. DPR (Daily Progress Report), DLR (Daily Labour Report), attendance, next-day plan, and evidence photos.
6. Workforce, technicians, vendors, and subcontractor records.
7. Material catalogue, purchase requests, inward receipts, consumption, transfers, returns, wastage, and stock balance.
8. Supplier invoices, worker payables, payments/advances, petty cash, reimbursement claims, and transaction attachments.
9. Safety incident, quality issue, and general site requirement/constraint reporting.
10. Notifications, approval queue, reporting dashboard, CSV/PDF exports, audit log, and basic administrative settings.
11. Offline drafts/queue for explicitly supported field workflows.
12. Backup/restore strategy, monitoring, error handling, and release documentation.

### 2.2 Out of scope for MVP unless separately approved

- Initiating actual UPI/NEFT/IMPS transfers from inside the app. The MVP records payments that have occurred externally and stores evidence; it does not move money.
- Biometric attendance hardware, facial recognition, continuous location tracking, or employee surveillance.
- Automatic statutory payroll, GST filings, e-invoicing, tax advice, or government portal integrations.
- Automatic tender submission or government Measurement Book (MB) acceptance.
- AI-generated engineering approvals, structural safety certification, or autonomous approval of site work.
- Full desktop web application. Admin features may be phone-friendly; a web admin console can be a later phase.
- Offline approval of high-risk financial transactions, hiring commitments, permission changes, or other actions that need current server-side limits and balances.

### 2.3 Later-phase capabilities

- Purchase orders and supplier quotation comparisons.
- BOQ/MB measurement books with rate analysis and controlled PDF exports.
- Budget vs actual, item-wise cost-to-complete, and project profitability.
- GPS geofenced check-in with accuracy indicators and an explicit company policy.
- Integrations with accounting software, payment providers, e-signature providers, or government systems after requirements and compliance review.
- Advanced analytics and AI assistance for searching reports or drafting summaries; AI output must be labelled as a draft and must never post financial transactions or approve engineering/safety matters automatically.

---

## 3. Important Corrections to the Initial Concept

The following changes are deliberate because the original version contains behaviours that could create inaccurate accounts or unsafe operations.

### 3.1 Separate Developer Support from Company Administration

A software developer/platform operator is **not** a normal business role with unrestricted access to client finances. The production system must separate:

- **Organisation Owner / Director:** controls JP Infracon's business data and users.
- **Platform Support Operator:** technical support role outside the organisation's normal workflow. It has no default access to client business records. Any exceptional support access must be time-limited, approved, and audited.

Do not ship a universal developer login, fixed hidden password, shared master account, or client-data backdoor.

### 3.2 Do Not Shift Every Future Task Automatically Without Review

A delay to one task can affect dependent work, resource availability, non-working days, concrete curing, inspections, and parallel tasks. The app must show an **impact preview** before rescheduling. It must not silently shift all future tasks by a fixed number of days.

Required behaviour:
1. User selects a task, reason, revised date, and rescheduling strategy.
2. The app previews dependent tasks, date conflicts, and affected resource assignments.
3. The user confirms the change or requests approval.
4. The system preserves the original plan and writes a schedule revision/audit event.

### 3.3 Do Not Store Stock as a User-Editable Number

The displayed stock is calculated from material movements. Inward, issue/consumption, return, transfer, wastage, and approved adjustments must be recorded as separate entries. A supervisor should not be able to type `current_stock = 255` and overwrite the ledger.

### 3.4 Do Not Treat a GPS Pin as Proof of Presence

Capture GPS coordinates only when justified by the workflow and user permission. Save accuracy, capture time, and location permission status. Show a clear warning when accuracy is poor. GPS can be unavailable or spoofed; it is corroborating evidence, not conclusive proof.

### 3.5 Fix Worker and Supplier Balance Mathematics

Balances must derive from approved earnings/invoices and posted payments. An advance must be included once only; never subtract the same advance both as a payment and again as a payroll deduction. Supplier freight paid to a separate transporter is a separate expense, not automatically a payment to the material supplier.

### 3.6 Separate a Payment Record from a Real Bank Transfer

The MVP records that an authorised user says a payment was made and supports a receipt/screenshot/reference. It does not claim to verify or execute a UPI/bank transaction. Payment status should be `Draft`, `Submitted`, `Approved` (if needed), `Posted`, `Rejected`, or `Reversed`, not a misleading `Success` merely because the user tapped a button.

### 3.7 Keep Sensitive Identity Data Minimal

Do not require full Aadhaar numbers as a routine worker-registration field. Default to the minimum necessary identity information, masked references where appropriate, explicit purpose/consent/notice, restricted document access, encryption, retention rules, and deletion/archival procedures. Do not log identity documents or raw identity numbers in application logs. A legal/compliance review is required before collecting or retaining Aadhaar data or images.

### 3.8 Do Not Store Everything in JSON Blobs

Attendance, report line items, permissions, payments, stock movements, and payment allocations need normalised relational records and database constraints. JSON may be used for genuinely flexible metadata, not as a substitute for core transactional tables.

---

## 4. Users, Roles, and Authority

### 4.1 Business roles

| Role | Typical user | Default scope | Main responsibilities |
|---|---|---|---|
| Organisation Owner / Director | Company directors | All organisation projects and sites | Full business oversight, user/role assignment, budgets, approval policies, high-value approvals, reports, audit access |
| Organisation Admin | Trusted office administrator | Assigned organisation scope | Maintain projects, assign users, configure workflows, approve requests within authority, manage master data |
| Project Manager | Project lead | Assigned projects/sites | Schedule, progress, site allocation, issue resolution, review reports and field requests |
| Site Supervisor / Site Engineer | Field engineer/supervisor | Explicitly assigned sites | DPR/DLR, site attendance, work updates, material movements, requests, permitted purchases/payments, safety/quality reporting |
| Accounts / Finance | Accountant/accounts clerk | Financial records for assigned scope | Reconcile bills/payments, post or review transactions, financial reports, petty-cash reconciliation |
| Storekeeper | Store/material custodian | Assigned store/site | Record receipts/issues/transfers, maintain material evidence and stock counts |
| Auditor / Read-only Reviewer | Internal/external reviewer | Granted read-only scope | View reports, evidence, audit logs, and financial summaries without modifying operational data |
| Platform Support Operator | Technical support | No business-data access by default | Health checks, deployment, diagnostics, approved time-limited support access only |

A single person may have more than one business role, but the system must apply the least-privilege rule and record which identity performed each action.

### 4.2 Dynamic permission model

Permissions are assigned to a user with a scope (organisation, project, or site). Permissions must be configurable in the admin UI and evaluated by the backend on every protected operation.

Suggested permission keys:

- `project.view`, `project.manage`
- `site.view`, `site.manage`, `site.assign_users`
- `calendar.view`, `calendar.create_task`, `calendar.edit_task`, `calendar.reschedule`
- `dpr.create`, `dpr.submit`, `dpr.review`, `dpr.reopen`
- `dlr.create`, `dlr.submit`, `dlr.review`, `attendance.correct`
- `workforce.view`, `workforce.create`, `workforce.edit_rates`, `workforce.deactivate`
- `vendor.create`, `vendor.edit`, `vendor.commit_work`
- `material.view`, `material.request`, `material.purchase_direct`, `material.receive`, `material.consume`, `material.adjust_stock`, `material.approve_adjustment`
- `payment.create`, `payment.submit`, `payment.approve`, `payment.post`, `payment.reverse`
- `petty_cash.view`, `petty_cash.request_funds`, `petty_cash.record_expense`, `petty_cash.reconcile`
- `safety.create`, `safety.close`, `quality.create`, `quality.close`
- `reports.view`, `reports.export`, `audit.view`, `user.manage`, `permission.manage`, `settings.manage`

Financial permissions need more than a Boolean. For example, direct purchase permission should define:

- Allowed action: create purchase directly or only submit a request.
- Scope: which site/project.
- Maximum amount per transaction.
- Optional daily/monthly cumulative limit.
- Allowed categories or vendors, if applicable.
- Whether bill/receipt photo and a reason are mandatory.
- Effective start/end, status, granting director/admin, and revocation details.

### 4.3 Permission enforcement rules

1. Backend checks the user's active account, organisation membership, site assignment, permission, limit, and any approval requirement on every write.
2. Changing a UI toggle is not enough; the grant must be saved server-side and audited.
3. A revoked permission blocks new actions immediately once the backend receives the change. Already posted transactions are not silently deleted.
4. Pending requests retain history. If policy requires cancellation after revocation, the system must mark them for review rather than erase them.
5. An amount over the user's authority is routed to approval; the app must not permit splitting one purchase into smaller transactions to bypass limits. Flag repeated related requests for admin review.
6. The app must show the user why an action is blocked and what approval is needed.
7. At least two distinct authorised people should be supported for request/approval where the company chooses a maker-checker process. Do not hard-code the same person as both requester and approver for high-risk transactions.

### 4.4 Suggested MVP approval policy (configurable)

Do not hard-code example amounts such as ₹25,000 or ₹50,000 as universal limits. The organisation admin must set them.

| Action | Default MVP policy |
|---|---|
| Routine DPR/DLR submission | Supervisor can submit; manager/admin can review or return for correction |
| Material request | Supervisor can request; assigned approver accepts/returns/rejects |
| Direct purchase | Only when explicit permission and amount/category limits allow it; evidence required |
| Stock adjustment or write-off | Reason and evidence required; supervisor requests, authorised manager approves |
| Worker/vendor onboarding | Permitted supervisor may draft; authorised user approves active status/rates if policy requires |
| Worker rate change | Privileged permission and effective date; old rate retained in history |
| Payment/advance | Submit/approve/post according to amount and role policy; prevent unauthorised self-approval |
| Petty-cash funding | Created by authorised finance/admin and acknowledged by custodian |
| Payment reversal | Restricted permission, reversal reason, and reference to original transaction required |

---

## 5. Primary User Journeys

### 5.1 Director's daily review

1. Sign in with an individual account.
2. See an organisation dashboard with project/site filters and data freshness time.
3. Review sites with missing DPR/DLR, delayed tasks, open safety/quality issues, low stock, pending approvals, and upcoming payables.
4. Open an item to inspect the original report, receipt, transaction, or audit history.
5. Approve, return, reject, or comment only when the current role and permission allow it.
6. Export a report with filters and a generated-at timestamp.

### 5.2 Site supervisor's workday

1. Open assigned site and see today's tasks, previous day's open issues, pending material requests, and report reminders.
2. Record workforce attendance, using the approved worker roster.
3. Record task quantities/progress and attach site evidence.
4. Record inward materials/consumption/expenses only within assigned permissions.
5. Report safety, quality, delay, or resource problems.
6. Submit DLR and DPR; the app clearly shows `Draft`, `Pending Sync`, `Submitted`, `Returned`, or `Approved`.
7. Check the next-day plan and handover notes.

### 5.3 Accounts team's reconciliation

1. Open payments/bills awaiting verification.
2. Compare invoice, receipt, purchase request/order, payment proof, and site acknowledgement.
3. Confirm the payment source and beneficiary; allocate it to one or more invoices/payables.
4. Post only after required checks pass.
5. Review supplier/workforce balances and petty-cash reconciliation.
6. Export date-bounded ledgers and review any unreconciled items.

---

## 6. Functional Requirements

## 6.1 Authentication, Account Lifecycle, and Organisation Setup

**Requirements**

- Individual account for each staff member; no shared supervisor logins.
- Sign-in with a verified phone/email-based account flow supported by the chosen auth provider. If OTP is used, configure rate limiting and resend cooldowns.
- Secure session refresh, logout, account disable, and lost-device/session revocation.
- Admin can invite a user, assign role(s), assign project/site scope, and set permission grants.
- User status: `Invited`, `Active`, `Suspended`, `Deactivated`.
- Site staff must not see a site merely because they know its ID or URL.
- Every created business record includes organisation, creator, created time, and current status.

**Acceptance criteria**

- A supervisor assigned to Site A cannot fetch Site B data by changing a request ID.
- A deactivated user cannot create new records and loses active sessions according to the configured session policy.
- The app does not include a default production admin password or hidden backdoor.

## 6.2 Project and Site Master

**Project fields**

- Project code (unique within organisation), project name, client/department, project type, contract/agreement reference, agreement value (optional restricted field), work order date, start date, target completion date, project manager, status, currency (INR for initial deployment), address/region, notes, documents.
- Project types are configurable: pipeline, water supply, OHT/reservoir, pump house, RCC building, compound wall, solar pump, maintenance, and custom types.

**Site fields**

- Site code, site name, parent project, address/village/block/district/state, optional coordinates, site contact, site supervisor(s), working days/calendar, time zone (default India), current phase, status, site instructions, and risk/constraint notes.
- A project may have multiple sites. Calendars, stock, and field reports are site-scoped unless the user explicitly opens a project-level roll-up.

**Validation**

- Target completion date cannot precede start date without an authorised override and reason.
- Agreement value is visible only to authorised finance/director roles.
- Deactivated projects/sites remain available for historical reporting and audit, but reject new routine entries unless reopened by an authorised user.

## 6.3 Site Calendar and Task Scheduling

**Task fields**

- Task ID/code, site, title, description, work category, location/zone/chainage/structure, planned start/end, actual start/end, priority, assignee/team, predecessor/dependency tasks, target quantity and unit (where measurable), status, delay/hold reason, attachments, created by, approved/revised schedule history.

**Statuses**

`Planned`, `Ready`, `In Progress`, `On Hold`, `Completed`, `Cancelled`, `Blocked`, `Awaiting Inspection`.

**Required features**

- Day/week/month list/calendar views; today's plan, tomorrow's plan, and overdue tasks.
- Create, edit, duplicate, hold, cancel, complete, and request reschedule.
- Delay reasons include weather/rain, material shortage, labour shortage, equipment breakdown, drawing/approval pending, inspection pending, access issue, safety issue, client instruction, and other with required notes.
- Reschedule preview shows task dependencies, clashes, affected subsequent work, and current vs proposed dates.
- Preserve schedule revisions; never overwrite the only copy of the original plan.
- Site calendars are independent. A reschedule at Site A must not affect Site B unless a shared resource constraint is intentionally modelled.
- Workdays, holidays, curing/inspection buffers, and dependency behaviour are configurable; no unexplained automatic shift of all later tasks.
- A schedule change requiring approval goes to an approval queue; it is not applied until approved.

**Acceptance criteria**

- If a task is held due to rain, the user can enter the reason and request a new date.
- Dependent tasks are previewed before the new schedule is committed.
- The original planned date and every approved revision remain queryable.

## 6.4 DPR — Daily Progress Report

Each site can have one DPR per workday or multiple shift-based reports if configured. Prevent accidental duplicates while allowing a controlled correction/revision workflow.

**Header fields**

- Site, report date, shift, supervisor, weather (optional), overall site status, workforce summary, equipment used, delay/constraint summary, safety/quality highlights, material issues, next-day priorities, remarks, and status.

**Progress line items**

- Task/BOQ/work item, work location, planned quantity, completed quantity for the day, cumulative completed quantity, unit, estimated completion percentage (if useful), measurement notes, blockers, and evidence attachments.
- If the app permits a manually entered percentage, label it as an estimate and do not derive contract payment solely from that percentage.
- Do not allow cumulative quantity to exceed approved scope without a variation/change-order record or authorised override.

**Evidence**

- Support multiple photos and documents per report.
- Store files in private object storage, not as base64 in the relational database.
- Store attachment metadata: uploader, uploaded time, object key, file size/type, optional capture time, optional GPS coordinate/accuracy, and checksum.
- Users can preview attachments; downloads are delivered only after authorisation.
- If a photo was selected from the gallery, do not label it as a verified live capture. Where device capability allows, distinguish `Captured in app` from `Selected from device` without making claims beyond what can be technically verified.

**Workflow**

`Draft` → `Pending Sync` (offline) → `Submitted` → `Under Review` → `Approved` or `Returned for Correction`.

Only authorised users can reopen a submitted/approved report. Corrections create a new revision or an amendment with a reason; history is retained.

## 6.5 DLR — Daily Labour Report and Attendance

**Attendance fields**

- Site, date, shift, worker, attendance state (`Full Day`, `Half Day`, `Absent`, `Leave`, `Present—hours-based`), regular hours, overtime hours, overtime approval, rate version, attendance note, marked by, reviewed by, and timestamps.
- A worker can be assigned to only one site for the same period unless the company explicitly enables split-site attendance with times that do not overlap.
- Duplicate attendance for the same worker/site/date/shift must be blocked or routed through a correction flow.
- Optional attendance capture evidence (timestamp/site location) must be transparent, policy-based, and permission-controlled.

**Rate rules**

- Worker rates support daily, hourly, shift, piece-rate, per-connection, per-measurement, and contract-based arrangements.
- Rate changes are versioned with effective-from date, author, approver where required, and reason. Past attendance must use the rate effective for that work date unless corrected through a controlled adjustment.
- Attendance and payment calculations must use decimal-safe currency arithmetic (integer paise or a fixed-precision decimal type), not floating-point arithmetic.

**DLR summary**

- Present headcount by trade/skill, absent count, total regular hours, approved OT hours, estimated earned labour cost, and exceptions such as missing rate or unapproved OT.
- Estimated cost is not a posted payable until the company's review/approval process completes.

## 6.6 Workforce, Technicians, Vendors, and Subcontractors

**Worker/person profile**

- Internal ID, full name, mobile number (optional only if the business permits), emergency contact (optional), address at a minimum necessary level, skill category (`Skilled`, `Semi-skilled`, `Unskilled`), trade (`Mason`, `Helper`, `Plumber`, `Electrician`, `Bar Bender`, `Carpenter`, `Operator`, `Painter`, `Welder`, `Other`), onboarding date, status, source/site, notes, and approved rate arrangement.
- DOB should be optional unless the business has a documented need. Do not collect fields simply because a form has room for them.
- KYC state should be `Not Required`, `Pending`, `Verified by authorised reviewer`, or `Rejected`; the app must not falsely claim that it verifies a document automatically if no verification service exists.
- Do not store a full Aadhaar number by default. If identity documentation is genuinely required, follow a reviewed lawful process and limit access/retention. Masked values/documents can still be sensitive.
- Use soft deactivation for history; do not delete a worker who has attendance or payments.

**Employment/engagement fields**

- Site assignment, engagement start/end, trade, rate type, rate, currency, contract reference, approved by, effective dates, and status.
- A worker can have different rates for different sites or periods through separate engagement/rate records.

**Vendor/supplier/subcontractor profile**

- Entity type (`Material Supplier`, `Transporter`, `Equipment Hire`, `Trade Contractor`, `Subcontractor`, `Service Provider`), legal/trading name, contact, address, optional tax identifiers subject to policy, payment terms, bank/payment details under restricted access, documents, categories supplied, status, and notes.
- Subcontract measurement/work quantities and agreed rate must be tracked separately from labour attendance so the same work is not paid both through attendance and contract measurement unless explicitly allowed.
- A supplier invoice and a worker payout are different ledger relationships; do not collapse all payees into a single name-only string.

## 6.7 Material Catalogue, Purchase, Inventory, and Stock Control

**Material catalogue**

- Item code, item name, category, specification/grade/size, base unit, allowed alternate units and conversion factors, reorder threshold, preferred suppliers (optional), active status, and notes.
- Examples: cement (bag), TMT steel (kg/tonne), sand (m³/truckload as defined), aggregate (m³/tonne as defined), HDPE/DI/PVC pipe (metre/length and diameter/class), fittings, solvent, electrical items, solar panels, pump, fuel, and consumables.
- Unit conversions must be explicit and approved. Do not assume a truckload or bag has a standard quantity if the company has not configured it.

**Material request/purchase process**

1. Supervisor raises a request with item, quantity, required-by date, site, purpose/task, preferred supplier (optional), and urgency.
2. Approval policy checks role, amount/category limit, budget if configured, and stock already available.
3. The request can be approved, partially approved, returned, rejected, or cancelled with a reason.
4. A purchase order/commitment may be recorded. A direct purchase is allowed only when the user has explicit permission and is within limits.
5. On arrival, storekeeper/supervisor records a goods receipt against the request/order where available, actual quantity, accepted/rejected quantity, supplier delivery note, bill/challan photos, and discrepancies.
6. Invoice and payment are recorded separately; receipt of goods does not automatically mean the invoice is approved or paid.

**Material movement types**

- `Opening Balance`, `Receipt/Inward`, `Issue/Consumption`, `Return to Store`, `Transfer In`, `Transfer Out`, `Wastage`, `Damage`, `Approved Adjustment`, `Reversal`.
- Every movement records quantity, unit, site/store, item, linked source record, author, timestamp, reason, and evidence where required.
- Stock = sum of posted inbound movements minus posted outbound movements, applying explicit unit conversions. Draft/unapproved transactions do not affect official stock.
- Prevent negative stock by default. If the business enables a negative-stock override, require elevated permission, reason, and audit event.
- Transfers must create linked outbound and inbound movement records so the two site balances reconcile.
- Never silently delete a stock movement. Correct it with a reversal/correction entry.
- Support physical stock count and variance workflow: count → variance report → approval → adjustment movement.

**Acceptance criteria**

- After 300 bags received and 45 bags of approved consumption posted, available stock is 255 bags, assuming no other movement.
- A draft inward entry does not change official stock until posted.
- A rejected delivery quantity is not added to usable stock.
- Changing a historic quantity leaves an auditable correction record.

## 6.8 Financial Ledger, Labour Payables, Supplier Bills, and Payouts

### 6.8.1 Core transaction rules

- Currency: INR for the initial deployment. Store the amount as integer paise or fixed-precision decimal; display as ₹ with locale formatting.
- A financial transaction must have a unique ID, organisation, site/project if applicable, transaction type, amount, currency, date/time, creator, status, source account/funding source, payee/payer, purpose/category, evidence/reference, and audit history.
- Payment modes: `Cash`, `UPI`, `Bank Transfer`, `Cheque`, `Card`, `Other`. Payment references and screenshots are optional/required based on policy. A screenshot is evidence attached by the user, not independent bank verification.
- Distinguish `Paid by` (actual person who disbursed/recorded the payment) from `Funding source` (`Site Petty Cash`, `Company Bank`, `Supervisor Personal Funds`, `Other`).
- If a supervisor pays from personal funds, record a reimbursement claim/liability to that supervisor. Do not reduce the site petty-cash balance for money that did not come from site petty cash.
- Do not allow hard deletion of posted financial transactions. Correct errors by reversal and replacement linked to the original entry.
- Prevent duplicate submission using an idempotency key so a retry after poor connectivity cannot create two payments.

### 6.8.2 Payment lifecycle

`Draft` → `Submitted` → optional `Approved` → `Posted`.

Additional terminal/exception states: `Rejected`, `Cancelled`, `Reversed`. The exact transitions depend on permissions and approval policy. `Posted` means entered into the application's official ledger; it does **not** mean the app independently verified a bank transfer.

### 6.8.3 Worker earnings and balance calculation

Use approved attendance/measurement and versioned rates to calculate gross earned amount for a period. All money actually disbursed to a worker—including wage settlement and cash advance—must be represented once as a posted payment with an appropriate type/allocation.

**Illustrative balance rule:**

`Outstanding worker payable = approved earned amount − posted payments allocated to that worker/engagement/period ± approved adjustments`.

- A ₹1,500 advance paid to a worker is a real disbursement and must reduce the unpaid amount exactly once.
- If disbursements exceed approved earnings, show the resulting advance/overpayment balance separately and require an authorised settlement/recovery policy; do not hide negative balances.
- Show total earned, total disbursed, outstanding payable, advances, pending approval, and disputed/corrected items separately.
- Do not let a manually typed `pending_balance` become the source of truth.

### 6.8.4 Supplier bills and payables

- Supplier invoices need invoice number, supplier, invoice date, due date, items/quantities, tax/charges where configured, gross/net amount, site/project allocation, attachments, review status, and purchase/receipt references.
- A payment is allocated to one or more supplier invoices, with amount per allocation.
- `Outstanding supplier payable = approved invoice amount − posted payment allocations ± approved credit/debit notes`.
- A transporter's ₹5,000 freight payment is payable/expense for the transporter if the transporter is the beneficiary; it does not reduce a material supplier's invoice unless the invoice/allocation clearly says it should.
- Support part-payments, advance payments, retained amounts if applicable, credit notes, and disputed invoices as separate states.

### 6.8.5 Petty cash and supervisor reimbursement

- A petty-cash fund has a custodian, site, opening/funding transactions, authorised limits, and reconciliation period.
- Balance is derived from posted fundings, posted cash expenses/payments, cash returns, and approved reconciliation adjustments.
- Each expense includes category, amount, date, payee, payment mode, source account, purpose, site/task allocation, receipt or reason if receipt is unavailable, submitted/approved status, and creator.
- Reconciliation compares system balance with physical cash; variance requires a reason and approval.
- A ₹50,000 funding minus ₹15,000 labour disbursement minus ₹8,000 diesel/material expense minus ₹2,000 refreshment/repair expense yields ₹25,000 only if all three expenses are posted against that same petty-cash fund and no other movement occurred.

### 6.8.6 Categories

Examples configurable by admin:

- **Labour:** wage settlement, wage advance, medical assistance, travel, food/ration/kharchi, overtime, correction/adjustment.
- **Material:** material advance, invoice settlement, transport, unloading, handling, rejected material credit, return.
- **Site expense:** fuel/diesel, equipment hire, repairs, communications, accommodation, water/electricity, approved refreshments, emergency expenses.
- **Supervisor:** salary, fuel allowance, room rent, travel reimbursement, mobile allowance, other approved reimbursement.

### 6.8.7 Salary and facilities

- Supervisor salary and benefits are stored in a restricted compensation module, not on the generic user row.
- Model salary as effective-dated compensation records: amount, frequency, effective-from/to, approved by, and history.
- Facilities are separate records: company bike/vehicle, fuel allowance, accommodation/room rent, phone/mobile recharge, travel allowance, meals, and other policy-defined benefits. Record whether a benefit is a cash allowance, reimbursement, or company-provided facility.
- Salary and personal compensation are visible only to explicitly authorised roles.

## 6.9 Safety, Quality, Delay, and Requirements Register

The user must be able to record site issues that need follow-up rather than burying them in DPR notes.

**Issue types**

- Safety hazard/incident/near miss.
- Quality non-conformance/defect/inspection observation.
- Material requirement/shortage.
- Drawing/approval/utility/access constraint.
- Equipment breakdown.
- Client instruction or site coordination issue.
- Other site requirement.

**Required fields**

- ID, site, issue type, title, description, risk/severity, location, raised by/time, photos/files, immediate action, assigned owner, target resolution date, status, comments, corrective/preventive action, reviewer/closure evidence, and complete status history.
- Severe safety issues can be configured to trigger immediate high-priority notifications and a stop-work/escalation workflow. The app itself does not certify that a hazard is safe.
- Reopening a closed issue requires a reason and audit event.

## 6.10 Notifications and Approval Queue

- In-app notifications for DPR/DLR missing/returned/approved, material request updates, low stock, approaching task deadlines, schedule changes, payment approval, invoice due dates, safety/quality escalations, and permission changes.
- Push notifications use a supported provider such as Firebase Cloud Messaging; push delivery is best-effort and the in-app inbox remains the source of truth.
- Notification payloads must not expose sensitive identity or financial details on a locked screen. Prefer generic text such as “A payment requires review”.
- Each notification deep-links to an authorised record; opening it rechecks access.
- Users can mark read/unread; notifications do not replace formal approval records.

## 6.11 Dashboard and Reports

**Director dashboard**

- Active projects/sites, progress summary, due/overdue tasks, DPR/DLR submission status, reported manpower, open safety/quality issues, low-stock alerts, pending material approvals, cash/petty-cash balances, outstanding worker/supplier dues, and upcoming due dates.
- Each metric must be calculated from real persisted data and indicate the filter/date range and last refresh/update time.
- If there is no data, show an empty state such as “No reports submitted for this period,” not invented values.

**Supervisor dashboard**

- Assigned sites only; today's schedule; incomplete reports; roster/attendance; pending material; stock alerts; open issues; cash-fund balance if authorised; and next-day plan.

**Required exports**

- DPR by site/date range.
- DLR/attendance by site/date/worker/trade.
- Task calendar and delays.
- Material receipts/consumption/stock ledger and stock-on-hand report.
- Worker ledger and payment history.
- Supplier invoices, payments, and pending dues.
- Petty-cash fund ledger and reconciliation.
- Safety/quality register.
- Permission changes and audit report.

Exports must include organisation/site, filter range, generated timestamp, and pagination/continuation markers where applicable. PDF layouts should be printable and CSV should escape untrusted text fields to reduce spreadsheet formula-injection risk.

## 6.12 Offline and Synchronisation Behaviour

Field connectivity may be unreliable. Offline mode must be designed, not added as a generic “offline” badge.

**Offline-capable operations**

- View previously synchronised assigned-site data.
- Draft DPR/DLR and attendance records.
- Draft issue reports and attach locally captured photos.
- Draft material requests and non-financial notes.
- Queue permitted routine records for sync with a visible status.

**Online-required operations by default**

- Approval or posting of payments.
- Permission changes, user activation, role changes.
- High-value purchase commitments.
- Stock adjustments that require current balance/approval.
- Any operation requiring a current server-side limit or a unique allocation.

**Sync requirements**

- Use a local database/cache such as Room and a durable sync queue.
- Every queued mutation receives a client-generated UUID/idempotency key.
- Track `Local Draft`, `Pending Sync`, `Synced`, `Conflict`, and `Sync Failed` statuses.
- Never show a pending offline action as approved/posted.
- On conflict, preserve the local entry and server version; display a reconciliation choice or route to a controlled resolution screen. Never silently overwrite server-approved data.
- Upload photos using resumable/retryable transfers where supported. Do not delete local files until the server confirms upload and the associated record is safely synchronised.
- Show last successful sync time and a manual retry option.

---

## 7. Screen and Navigation Specification

Use native Android UI and a consistent design system. Minimum supported screen width and Android version should be finalised during build setup; layouts must support common low- and mid-range Android phones.

### 7.1 Main navigation

Suggested bottom navigation for field users:

1. **Home**
2. **Sites**
3. **Reports**
4. **Requests**
5. **More**

Admin/finance users receive only the sections permitted by their roles. Do not show unavailable features as active buttons that lead nowhere.

### 7.2 Required screens

1. Splash/loading and first-run configuration.
2. Sign-in, OTP/verification, session expired, and account-disabled states.
3. Role-appropriate dashboard.
4. Project list/detail and project creation/edit.
5. Site list/detail, site assignment, and site information.
6. Calendar/day-plan/task list, task detail, reschedule impact preview, and revision history.
7. DPR create/edit/preview/submit and report detail/review/amendment history.
8. DLR attendance roster, worker attendance, OT entry, summary, submit, and correction history.
9. Workforce list/profile/onboarding/rate-history/engagements.
10. Vendor/supplier/subcontractor list/profile/documents/work measurements.
11. Material catalogue, stock ledger, request form, approval view, receipt/inward, consumption/issue, transfer, physical count, variance approval.
12. Invoices, payables, payment draft, payment review/post, allocations, proof preview, reversal, and ledger detail.
13. Petty-cash fund, cash expense, reimbursement claim, and reconciliation.
14. Safety/quality/requirement issue list, create/detail, corrective action, and close-out.
15. Approval inbox and notification inbox.
16. User/role/site assignment and permission-grant editor.
17. Supervisor compensation/facilities (restricted).
18. Reports/export filters and export history.
19. Audit log detail.
20. Profile, language, notification preferences, offline/sync status, help, privacy notice, and logout.

### 7.3 UX quality requirements

- Clear loading, empty, error, permission-denied, offline, and retry states.
- Confirmation dialog for destructive/high-impact actions and a required reason for reversal, reschedule, stock adjustment, and approved-record correction.
- Save drafts where appropriate; warn before leaving a form with unsaved edits.
- Avoid huge single-screen forms. Use grouped sections and a review screen before submission.
- Use human-readable errors; never expose raw database stack traces to users.
- Show units next to quantities and currency next to money. Distinguish estimates from approved/posted values.
- Photo upload shows progress, retry, and per-file failure state.
- Use accessibility labels, adequate touch targets, screen-reader support, and legible contrast.
- Support English first, with language-ready text resources. Hindi and Odia should be included if approved in the release scope; do not hardcode user-facing strings throughout the source code.

---

## 8. Recommended Technical Architecture

The implementer may propose a different stack, but must preserve all security, transactional, offline, and audit requirements. The following is the default reference architecture.

### 8.1 Android app

- **Language/UI:** Kotlin + Jetpack Compose + Material 3.
- **Architecture:** feature-based modules using MVVM or a similarly maintainable unidirectional state-flow architecture.
- **Networking:** Retrofit/OkHttp or an equivalent typed HTTP client, TLS only, structured error handling, bounded retries, request IDs, and idempotency keys for mutations.
- **Local persistence:** Room database for cached data and offline drafts/sync queue.
- **Background work:** WorkManager for safe retryable sync and uploads; do not repeatedly poll aggressively.
- **State:** ViewModel + Kotlin coroutines/Flow or equivalent.
- **Media:** Android photo picker/camera integration with upload progress and explicit permissions. Do not request all-files access when a system picker suffices.
- **Secrets:** no server secret, database password, service-role key, signing private key, or unrestricted API token embedded in the APK.

### 8.2 Backend and database

- **API:** server-side REST API (for example, NestJS/TypeScript or Spring Boot) with schema validation and a central permission policy layer.
- **Database:** PostgreSQL with migrations, foreign keys, unique constraints, check constraints, indexes, transactions, and backup/restore procedure.
- **Object storage:** private object storage for photos, reports, invoices, and KYC documents; downloads use authorised, short-lived access links or authenticated API streaming.
- **Authentication:** trusted authentication provider with individual accounts, access/refresh-session policy, account disable/revocation, and rate limiting.
- **Notifications:** Firebase Cloud Messaging or equivalent.
- **Background jobs:** job queue/scheduled tasks for reminders, due-date alerts, export generation, and retryable processing. A job must be idempotent.
- **Deployment:** separate development, staging, and production environments; secrets managed by the deployment environment, not source code.

### 8.3 Backend rules

- The server is authoritative for role/permission checks, approval thresholds, monetary balances, stock balances, and report status transitions.
- Mobile clients must never directly set calculated balance totals or arbitrary transaction status values.
- Every write endpoint checks the requested object's organisation/site scope as well as its identifier.
- Use database transactions for posting a payment, allocating a payment, posting stock movements, or approving an operation that changes multiple records.
- API requests must be validated on the server even if the Android form validates them.
- Keep request/trace IDs and structured logs, but redact phone numbers, identity data, tokens, and payment details.

### 8.4 Environment configuration

Create separate configuration for:

- API base URL.
- Authentication provider/tenant identifiers.
- Private storage bucket/container.
- Push notification project/configuration.
- Analytics/crash-reporting choice and privacy settings.
- Feature flags and maintenance mode.

Never commit production secrets to Git. Provide `.env.example` with placeholder names only, and document how to provision real secrets securely.

---

## 9. Data Model / Database Schema Blueprint

This is a relational blueprint, not a requirement to place all fields in one table. Use migrations and explicit foreign keys. Core records should be normalised.

### 9.1 Identity and access

**organisations**
- `id` UUID PK, `name`, `code` UNIQUE, `status`, `created_at`, `updated_at`

**users**
- `id` UUID PK, `auth_subject` UNIQUE, `display_name`, `phone`, `email`, `status`, `last_login_at`, `created_at`, `updated_at`
- Do not store salary, petty-cash balance, or a free-form JSON permissions object on this table.

**organisation_memberships**
- `id`, `organisation_id` FK, `user_id` FK, `business_role`, `status`, `joined_at`, `created_by`; UNIQUE (`organisation_id`, `user_id`, `business_role`)

**permission_grants**
- `id`, `organisation_id`, `user_id`, `scope_type`, `scope_id`, `permission_key`, `effect` (`allow`/`deny`), `max_amount_minor` nullable, `daily_limit_minor` nullable, `monthly_limit_minor` nullable, `allowed_categories` optional structured data, `effective_from`, `effective_to`, `granted_by`, `revoked_by`, `revoked_at`, `reason`, timestamps
- Add constraints that prevent invalid date ranges. Permission resolution precedence must be documented and tested.

**audit_events**
- `id`, `organisation_id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `occurred_at`, `request_id`, `before_summary`, `after_summary`, `reason`, `device_metadata` limited to approved non-sensitive fields
- Append-only for application users. Do not place passwords, tokens, full identity numbers, or raw payment credentials in audit payloads.

### 9.2 Project and scheduling

**projects**
- `id`, `organisation_id`, `project_code`, `name`, `client_department`, `project_type_id`, `agreement_reference`, `agreement_value_minor` nullable, `start_date`, `target_end_date`, `status`, `project_manager_user_id`, `created_by`, timestamps
- UNIQUE (`organisation_id`, `project_code`)

**sites**
- `id`, `organisation_id`, `project_id`, `site_code`, `name`, address/location fields, optional coordinates, `status`, `working_calendar_id`, timestamps
- UNIQUE (`organisation_id`, `site_code`)

**site_assignments**
- `id`, `site_id`, `user_id`, `assignment_role`, `effective_from`, `effective_to`, `status`, `assigned_by`

**work_tasks**
- `id`, `site_id`, `task_code`, `title`, `description`, `work_category_id`, `location_label`, `planned_start`, `planned_end`, `actual_start`, `actual_end`, `target_quantity`, `unit_id`, `priority`, `status`, `created_by`, timestamps

**task_dependencies**
- `predecessor_task_id`, `successor_task_id`, `dependency_type`, `lag_duration`; prevent self-dependency and detect dependency cycles.

**task_schedule_revisions**
- `id`, `task_id`, `old_start`, `old_end`, `proposed_start`, `proposed_end`, `reason_code`, `reason_text`, `impact_summary`, `status`, `requested_by`, `reviewed_by`, timestamps

### 9.3 DPR, DLR, and evidence

**daily_reports**
- `id`, `site_id`, `report_date`, `shift_code`, `supervisor_user_id`, `weather_code`, `overall_status`, `remarks`, `next_day_plan`, `status`, `revision_number`, `submitted_at`, `reviewed_by`, `reviewed_at`, `return_reason`, `created_by`, timestamps
- Add a uniqueness policy for site/date/shift with controlled revisions.

**daily_report_items**
- `id`, `daily_report_id`, `task_id` nullable, `work_item_code`, `location_label`, `planned_qty`, `completed_qty_today`, `cumulative_qty`, `unit_id`, `estimated_percent`, `remarks`

**attendance_records**
- `id`, `site_id`, `work_date`, `shift_code`, `worker_engagement_id`, `attendance_status`, `regular_hours`, `overtime_hours`, `overtime_approval_status`, `rate_snapshot_minor`, `currency`, `marked_by`, `reviewed_by`, timestamps, `correction_of_id` nullable
- Enforce uniqueness for worker/site/date/shift unless the split-shift model explicitly permits multiple records.

**attachments**
- `id`, `organisation_id`, `entity_type`, `entity_id`, `storage_key`, `original_filename`, `content_type`, `size_bytes`, `checksum`, `uploaded_by`, `uploaded_at`, `capture_time` nullable, coordinates/accuracy nullable, `source_type`, `access_classification`, `scan_status`
- Store file content in private object storage, not in this table.

### 9.4 Workforce and commercial parties

**people**
- `id`, `organisation_id`, `person_type`, `full_name`, `phone` nullable, minimal address fields, `skill_category`, `trade_type`, `status`, `kyc_status`, `created_by`, timestamps
- Avoid a routine full Aadhaar-number column. Any legally approved sensitive identity storage must be designed separately with restricted encryption/access and retention controls.

**worker_engagements**
- `id`, `person_id`, `site_id`, `engagement_type`, `rate_type`, `rate_minor`, `currency`, `unit_id` nullable, `effective_from`, `effective_to`, `status`, `approved_by`, `contract_reference`, timestamps

**worker_rate_history**
- `id`, `worker_engagement_id`, `rate_type`, `rate_minor`, `effective_from`, `effective_to`, `changed_by`, `approved_by`, `reason`, timestamps

**vendors**
- `id`, `organisation_id`, `vendor_type`, `legal_name`, `trade_name`, contact/address fields, restricted payment details reference, payment terms, status, created/updated metadata

**subcontract_measurements**
- `id`, `site_id`, `vendor_id`, `work_item_code`, `measurement_date`, `quantity`, `unit_id`, `agreed_rate_minor`, `gross_amount_minor`, `review_status`, evidence, created_by, reviewed_by, timestamps

### 9.5 Materials and procurement

**material_items**
- `id`, `organisation_id`, `item_code`, `name`, `category_id`, `specification`, `base_unit_id`, `reorder_threshold`, `status`, timestamps

**units_of_measure** and **unit_conversions**
- Store allowed conversions with explicit multiplier, source/target unit, approval, effective dates, and no ambiguous conversions.

**material_requests**
- `id`, `site_id`, `requested_by`, `required_by`, `purpose`, `status`, `estimated_amount_minor`, `approval metadata`, timestamps

**material_request_items**
- `id`, `request_id`, `material_item_id`, `requested_qty`, `approved_qty`, `unit_id`, `estimated_unit_cost_minor`, `remarks`

**purchase_orders** (MVP optional but recommended where the process requires a commitment)
- `id`, `site_id`, `vendor_id`, `request_id`, `po_number`, `status`, `order_total_minor`, `created_by`, `approved_by`, timestamps

**goods_receipts** / **goods_receipt_items**
- Receipt header: supplier/order/delivery note/date/site/status/author/reviewer.
- Receipt items: item, delivered quantity, accepted quantity, rejected quantity, unit, lot/batch if needed, discrepancy reason.

**material_movements**
- `id`, `site_id`, `material_item_id`, `movement_type`, `quantity`, `unit_id`, `base_quantity`, `source_entity_type`, `source_entity_id`, `from_site_id` nullable, `to_site_id` nullable, `status`, `reason`, `created_by`, `posted_by`, `posted_at`, timestamps
- Official stock is derived from posted movement rows. Use database transactions and appropriate locking/constraints for posting.

**stock_counts** / **stock_count_items**
- Physical count and system balance snapshot, variance, evidence, status, author, approver, and resulting adjustment link.

### 9.6 Invoices, payment ledger, and petty cash

**supplier_invoices**
- `id`, `organisation_id`, `vendor_id`, `site_id`, invoice number/date/due date, subtotal/tax/charges/total in minor currency units, status, receipt/PO links, attachment, entered_by, reviewed_by, timestamps

**financial_transactions**
- `id`, `organisation_id`, `site_id` nullable, `transaction_type`, `direction`, `amount_minor`, `currency`, `transaction_date`, `payment_mode`, `beneficiary_type`, `beneficiary_id`, `paid_by_user_id`, `funding_source_type`, `funding_source_id`, `purpose_category`, `description`, `external_reference` nullable, `status`, `idempotency_key`, `submitted_by`, `approved_by`, `posted_by`, `posted_at`, `reversal_of_id` nullable, timestamps
- UNIQUE on an appropriate idempotency scope. Enforce valid transaction-state transitions on the server.

**payment_allocations**
- `id`, `financial_transaction_id`, `target_type`, `target_id`, `allocated_amount_minor`, timestamps
- Allocation total cannot exceed posted payment amount; use a transaction when posting or changing allocations.

**worker_earnings_adjustments**
- `id`, `worker_engagement_id`, `period_start`, `period_end`, `adjustment_type`, `amount_minor`, `reason`, `status`, `created_by`, `approved_by`, timestamps

**petty_cash_funds**
- `id`, `site_id`, `custodian_user_id`, `fund_name`, `limit_minor`, `status`, timestamps

**petty_cash_movements**
- `id`, `petty_cash_fund_id`, `financial_transaction_id` or linked source, `movement_type` (`Funding`, `Expense`, `Return`, `Reconciliation Adjustment`), `amount_minor`, `status`, `reason`, `created_by`, `approved_by`, timestamps

**supervisor_compensation** / **supervisor_facilities**
- Effective-dated salary/allowance records and separate facility records with restricted read permissions.

### 9.7 Issues, configuration, and notifications

**site_issues**
- `id`, `site_id`, `issue_type`, `title`, `description`, `severity`, `location_label`, `status`, `owner_user_id`, `due_date`, `raised_by`, `closed_by`, timestamps

**issue_actions**
- `id`, `issue_id`, `action_type`, `notes`, `evidence_attachment_id`, `created_by`, timestamps

**approval_requests**
- `id`, `organisation_id`, `site_id`, `request_type`, `entity_type`, `entity_id`, `requested_by`, `assigned_approver_id` nullable, `amount_minor` nullable, `status`, `decision_reason`, `decided_by`, `decided_at`, timestamps

**notifications**
- `id`, `user_id`, `notification_type`, `entity_type`, `entity_id`, `title_key`, minimal payload, `read_at`, `created_at`

**organisation_settings** / **project_types** / **work_categories** / **expense_categories** / **delay_reason_codes**
- Configurable master data with active/inactive status and audit history.

### 9.8 Database implementation requirements

- Use UUIDs or equivalent non-guessable IDs, foreign keys, not-null/unique/check constraints, and indexes for site/date/status/beneficiary/report filters.
- Use migrations committed to source control; do not rely on manually editing production schema.
- Use database transactions when posting payments, posting material movements, applying approvals, or updating multiple related entities.
- Use optimistic concurrency/version fields for editable records that multiple staff may change.
- Store amounts consistently in minor currency units or a fixed-precision decimal type; never use binary floating-point for money.
- Add retention, archival, and deletion rules for personal data and attachments before production deployment.

---

## 10. API Contract Expectations

The exact endpoint naming can vary, but the implementation must provide equivalent server-enforced operations. Example REST endpoints:

### Identity and setup
- `POST /v1/auth/session` or provider equivalent
- `GET /v1/me`
- `GET /v1/me/permissions?siteId=...`
- `POST /v1/users/invitations`
- `PATCH /v1/users/{id}/status`
- `PUT /v1/users/{id}/site-assignments`
- `POST /v1/users/{id}/permission-grants`
- `POST /v1/permission-grants/{id}/revoke`

### Projects and schedule
- `GET/POST /v1/projects`
- `GET/POST /v1/sites`
- `GET/POST /v1/sites/{siteId}/tasks`
- `POST /v1/tasks/{taskId}/reschedule-proposals`
- `POST /v1/schedule-revisions/{id}/approve`

### Reports and workforce
- `POST /v1/sites/{siteId}/dpr-drafts`
- `POST /v1/dpr/{id}/submit`
- `POST /v1/dpr/{id}/review`
- `POST /v1/sites/{siteId}/attendance-batches`
- `POST /v1/dlr/{id}/submit`
- `GET/POST /v1/workforce`
- `POST /v1/workforce/{id}/engagements`

### Materials
- `POST /v1/material-requests`
- `POST /v1/material-requests/{id}/approve`
- `POST /v1/goods-receipts`
- `POST /v1/material-movements/drafts`
- `POST /v1/material-movements/{id}/post`
- `GET /v1/sites/{siteId}/stock`

### Finance
- `POST /v1/transactions/drafts`
- `POST /v1/transactions/{id}/submit`
- `POST /v1/transactions/{id}/approve`
- `POST /v1/transactions/{id}/post`
- `POST /v1/transactions/{id}/reverse`
- `POST /v1/transactions/{id}/allocations`
- `GET /v1/workforce/{id}/ledger`
- `GET /v1/vendors/{id}/payables`
- `GET /v1/petty-cash/{id}/ledger`

### Issues, notifications, and reporting
- `POST /v1/sites/{siteId}/issues`
- `POST /v1/issues/{id}/actions`
- `GET /v1/approvals`
- `GET /v1/notifications`
- `POST /v1/notifications/{id}/read`
- `POST /v1/reports/exports`
- `GET /v1/audit-events`

All list endpoints must use server-side pagination, filtering, and access checks. Write endpoints must validate input, enforce state transitions, generate audit events, and return a structured error code/message. For offline retries, support idempotency keys for creation/posting endpoints. Never accept `organisation_id`, `role`, `approved_by`, or `posted_by` from the client as trusted identity without verifying them against the authenticated session and permission policy.

---

## 11. Data Integrity and Business Rules

1. **One source of truth:** balances and dashboard totals are computed from approved/posted records; any cached totals must be rebuildable and verified against the ledger.
2. **No silent deletion:** financial, attendance, material movement, approved report, and schedule-change records use correction/reversal/revision flows.
3. **Status transitions are enforced server-side:** a client cannot set any entity directly to `Approved` or `Posted` unless the actor is authorised and the transition is valid.
4. **Time zones:** store timestamps consistently (UTC on the server is recommended) and display in the configured organisation/site time zone, initially Asia/Kolkata. Date-only work dates must not change because of UTC conversion.
5. **Duplicate prevention:** block duplicate attendance and repeated payment posting; use idempotency keys and database uniqueness constraints where appropriate.
6. **Concurrency:** if two users update the same record, detect stale versions and ask the user to refresh/resolve rather than overwriting silently.
7. **File security:** validate allowed file types/size, scan uploaded files where an appropriate service is available, and keep objects private by default.
8. **Evidence integrity:** preserve upload metadata and checksum; do not allow replacing evidence on an approved report without adding a revision.
9. **Audit history:** record actor, time, action, entity, reason, and changed fields for permissions, users, approvals, rates, inventory, financial transactions, report corrections, and rescheduling.
10. **No misleading metrics:** label planned vs actual vs approved; show “No data” or “Not submitted” when there is no record.
11. **Allocation consistency:** payment amount cannot be allocated beyond its posted amount; supplier payable cannot be reduced by an unrelated expense.
12. **Stock integrity:** stock changes only through valid posted movements; transfers must balance across source/destination.
13. **Approval separation:** policy can prevent the requester from approving their own high-risk financial request.
14. **Rate history:** changing a worker's current rate does not retroactively alter previously approved attendance or payments.
15. **Scope integrity:** moving a worker/task/transaction between sites must be an audited transfer/correction, not a simple foreign-key edit that hides history.

---

## 12. Security, Privacy, and Compliance Review Checklist

This section is an implementation checklist, not legal advice or a substitute for jurisdiction-specific review.

- Use HTTPS/TLS in all environments exposed outside a trusted local network.
- Enforce authorisation on the backend for every read/write and every file download.
- Store passwords only through a trusted auth provider; never log credentials or tokens.
- Protect refresh tokens and local session material using platform security facilities; clear sensitive cached data on logout/account revocation as appropriate.
- Encrypt backups and sensitive object storage; restrict production access to named operators.
- Use individual accounts, least privilege, and periodic access reviews.
- Require a reason and stronger review for permission escalation, transaction reversal, stock write-off, and compensation/rate changes.
- Do not place identity document numbers, full addresses, payment-account details, or sensitive reports in push-notification payloads or analytics events.
- Mask sensitive values in UI and restrict who can view/download identity documents, compensation, and bank details.
- Establish retention and deletion rules for inactive workers, user accounts, report photos, invoices, and identity documents. Preserve records that must legally be retained, subject to approved policy.
- Obtain and record appropriate notice/consent where required for personal data and location capture. Make location access purpose-limited; do not run continuous tracking by default.
- Review lawful collection/storage of Aadhaar or other identity data before implementation. Prefer not collecting it unless a clear, reviewed requirement exists.
- Define incident response, breach notification, backup retention, disaster recovery, and access revocation procedures.
- Review applicable Indian data-protection, Aadhaar, labour, tax, construction safety, accounting, and contractual requirements with qualified advisers before production use.

---

## 13. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Reliability | No data loss when the user retries after a network failure; idempotent mutation handling |
| Performance | Common list/detail screens should feel responsive on ordinary Android devices; use pagination and avoid fetching all site history at once |
| Offline | Supported drafts survive app restart/device network changes and show explicit sync state |
| Security | Server-enforced RBAC, least privilege, private attachments, secure session handling, no embedded privileged secrets |
| Auditability | Key actions have immutable/append-only audit events and reason capture where applicable |
| Maintainability | Feature-based source structure, tests, migrations, documented environment setup, no giant single-file implementation |
| Accessibility | Readable labels, sensible touch targets, contrast, screen-reader semantics, and form error summaries |
| Localisation | Text resources allow English, Hindi, and Odia; language scope confirmed before release |
| Backup | Automated database and attachment backup with documented restore procedure and periodic restore test |
| Monitoring | Crash/error monitoring and backend health metrics without sensitive-data leakage |
| Compatibility | Target Android SDK and minimum OS are documented before implementation; test on the declared range of real/emulated devices |
| Reporting | Exported data reconciles with the records shown in the app and identifies filter dates/generated time |
| Scalability | Paginated APIs, indexed queries, bounded media upload sizes, and background report generation for large exports |

Numeric performance targets should be agreed after a representative device/network test. Do not claim a measured performance target has been met without running the test.

---

## 14. Acceptance Criteria / Definition of Done

The app is not complete merely because the screens look correct. The following must pass in a working build.

### 14.1 Functional

- Admin can create a project/site and assign a supervisor.
- Supervisor can sign in and sees only assigned site data.
- Admin can grant a scoped permission with amount limit and revoke it; backend blocks unauthorised attempts even when a request is manually crafted.
- Supervisor can create and submit DPR and DLR with multiple line items/attendance rows and evidence attachments.
- Reviewer can approve or return a report; changes/revisions are visible.
- Calendar rescheduling shows impact and preserves the previous schedule.
- Inventory balance is derived from posted movements and passes the example receipt/consumption calculation.
- Material request approval, goods receipt, supplier invoice, part payment, and payable balance are linked correctly.
- Worker ledger shows approved earnings and actual payments/advances with no duplicate deduction.
- Petty-cash reconciliation calculates the example ₹25,000 remaining balance from posted entries only.
- A supervisor-paid personal expense creates a reimbursement claim and does not falsely reduce site petty cash.
- Payment reversal creates linked compensating records; the original posted entry remains traceable.
- App can draft offline, survive force-close/reopen, sync when online, and does not duplicate entries on retry.
- Dashboard values come from backend records and display empty states when data is absent.
- Reports export with filters and reconcile with the selected record set.

### 14.2 Security and integrity

- Cross-site and cross-organisation access tests fail as expected.
- A revoked user's API access is blocked.
- Only authorised users can download private evidence.
- A user cannot change transaction status/amount/creator/approver by editing a client request.
- Concurrent posting of the same transaction does not produce duplicate payments or stock movements.
- Sensitive values are redacted from logs and push notification content.
- No production secrets or universal passwords appear in source control or the APK.

### 14.3 Delivery

- Android Studio project opens and builds from documented instructions.
- Debug APK is provided for client testing and a signed release APK/AAB is prepared using the client's signing credentials when required.
- Backend source, migrations, deployment guide, environment variable list, seed/configuration procedure, backup/restore steps, and API documentation are delivered.
- Automated tests and a manual QA report are provided.
- No nonfunctional placeholder buttons, hardcoded “success” messages, or fake financial values remain in production paths.

---

## 15. Testing Strategy

### 15.1 Automated tests

- Unit tests: permission resolver, balance calculators, payment allocations, stock movement calculation, unit conversion, task-reschedule planner, status-transition rules, currency formatting, offline queue logic.
- API tests: unauthorised access, invalid states, amount limits, duplicate/idempotency handling, pagination, validation errors, and approval flows.
- Database tests: foreign keys, unique constraints, transaction rollback, concurrent posting, and migration upgrade paths.
- Android UI tests: sign-in states, forms, validation, offline banner, upload failure/retry, permission-denied state, and report submission.
- End-to-end tests: representative project workflow, material purchase-to-payable, attendance-to-worker-ledger, petty-cash funding/reconciliation, and report correction.

### 15.2 Manual QA matrix

Test at minimum:

- Good network, weak network, no network, network switch during upload, and app force-close during sync.
- Small phone screen, larger screen, accessibility text scale, and screen rotation if supported.
- Camera permission denied; photo picker used instead; storage upload rejected; file too large/unsupported type.
- Expired session, disabled account, lost connectivity during approval, permission revoked while app is open.
- Two users editing the same task or report; duplicate submit tap; app retry after ambiguous response.
- Time/date boundaries in India time zone; reports across month-end; daylight/time-zone conversion safeguards.
- Currency with partial allocations, part-payment, reversed payment, overpayment, zero-value/invalid amount, and missing receipt.
- Unit conversion and stock movements across sites; rejected/partial delivery; physical count variance.

---

## 16. Twenty Real-World End-to-End Scenarios

These scenarios are acceptance-test stories, not merely marketing examples. Each one must use persistent records and enforce the correct permissions.

### Scenario 1 — RCC slab casting DPR

A supervisor at the Vizag RCC site reports slab casting. They select the relevant task, enter the planned and completed quantities (or an explicitly labelled progress estimate), describe blockers, and attach four photos. The report is submitted and appears in the director's dashboard as pending review. The dashboard does not label it approved until an authorised reviewer approves it.

**Pass condition:** Photos are private attachments; report and line items persist; creator/time/status are visible; reviewer action is audited.

### Scenario 2 — Daily workforce attendance

At the start of the day, the supervisor selects the roster and marks attendance for four masons, two plumbers, three bar benders, and twelve helpers. The app flags missing rate records and duplicate attendance instead of silently calculating a false labour cost. Approved OT is handled separately.

**Pass condition:** DLR totals and estimated labour cost reconcile to attendance rows and effective-dated rates.

### Scenario 3 — Heavy rain and schedule replan

The Sheragada pipeline excavation task is blocked by heavy rain. The supervisor enters the reason and proposes a new date. The app previews dependent tasks, working days, and possible conflicts. The project manager approves the revision if policy requires it.

**Pass condition:** No unreviewed mass shift occurs; old and new dates remain in history; other sites are unchanged.

### Scenario 4 — Sand delivery delay and alternative task

Plaster work cannot proceed because sand has not arrived. The supervisor proposes boundary-wall brickwork as an alternative task, updates the plaster target date, and notes resource implications. The app does not remove or overwrite the original plaster plan.

**Pass condition:** Both schedule changes and delay reason are traceable; dependency conflicts are surfaced.

### Scenario 5 — Direct purchase within a delegated limit

A supervisor with active site-scoped direct-purchase authority buys five DI joints and solvent for a configured amount below their remaining limit. They record the supplier, items, amount, purpose, and receipt. The backend checks both per-transaction and cumulative limits.

**Pass condition:** The purchase is accepted only within the grant's scope/limit; purchase evidence and audit event are stored; a retry does not duplicate it.

### Scenario 6 — Night-time unloading/freight payment

A dumper arrives at 11 PM and a transporter requests ₹4,500. The supervisor records the beneficiary as the transporter, the funding source as site petty cash or personal funds, and the mode as Cash/UPI as applicable. If the supervisor used personal money, a reimbursement claim is created.

**Pass condition:** The app records the transaction but does not claim it executed UPI; the correct cash account/payable is affected.

### Scenario 7 — Hire an electrician for pump wiring

A permitted supervisor proposes a ₹12,000 electrician job. If the supervisor has authority to commit the amount, they can record the engagement; otherwise, the app raises an approval request. The person's rate/contract scope and start/end are captured.

**Pass condition:** Hiring authority and monetary limits are enforced server-side; contract measurement and labour attendance are not unintentionally duplicated.

### Scenario 8 — New supervisor has restricted authority

A new supervisor has no direct-purchase or payout permission. They request 100 cement bags. The app routes the request to an authorised approver and clearly explains why direct purchase is blocked.

**Pass condition:** The supervisor cannot bypass the block by editing an API call or entering a direct transaction screen.

### Scenario 9 — Screen new masons/helpers

Five workers are screened. The supervisor creates profile drafts with names, trade/skill, contact details where necessary, and rate proposals. Any KYC document is collected only if the approved company process requires it; access is restricted and status is not falsely marked verified.

**Pass condition:** Worker records are site-linked, duplicate records can be detected, sensitive identity data is minimised, and activation/rate approval follows policy.

### Scenario 10 — Plumber paid per connection

Three plumbers are engaged for household tap connections using a per-connection rate. The supervisor records completed connections with evidence and submits the measurement for review. The system calculates a proposed amount using the approved rate.

**Pass condition:** Payment is based on approved measurements and correct rate version, not on a daily wage assumption.

### Scenario 11 — Subcontractor shuttering measurement

A shuttering subcontractor is paid by square-foot measurement. The supervisor enters measured quantity, agreed rate, location, and evidence. A project manager reviews the measurement before it becomes payable.

**Pass condition:** Gross amount is reproducible from approved quantity/rate, and history remains if a measurement is corrected.

### Scenario 12 — Worker receives a ₹1,500 emergency advance

Ramesh receives a ₹1,500 advance. The supervisor records the actual payer, cash source, beneficiary, date, reason, and receipt/acknowledgement if available. When worker earnings are calculated, the advance is included exactly once in total disbursements.

**Pass condition:** If approved earnings are ₹3,000 and the only disbursement is ₹1,500, the outstanding amount displays ₹1,500—not ₹0 and not ₹3,000.

### Scenario 13 — Admin settles ₹14,000 by external UPI/bank transfer

A head mason's approved ledger shows ₹14,000 due. An authorised director pays externally and records the payment reference and evidence. The transaction is posted only after the company's configured checks.

**Pass condition:** The app shows who recorded/paid, mode, allocation, and zero outstanding only if the entire ₹14,000 is allocated and no other adjustment applies. The app does not represent the transfer as app-executed.

### Scenario 14 — Weekly kharchi and remaining dues

A plumber has ₹6,000 in approved earnings and receives ₹2,000 from the site cash fund as kharchi/advance. The ledger shows earned ₹6,000, disbursed ₹2,000, outstanding ₹4,000, with the transaction classified as a worker payment/advance.

**Pass condition:** The ₹2,000 appears once in the worker ledger and once as an outflow of the correct funding account, without duplicate financial counting.

### Scenario 15 — Cement inward and consumption

The site receives 300 cement bags; an accepted receipt is posted. Approved consumption of 45 bags is recorded later. Provided no other movements exist, the app shows 255 bags available.

**Pass condition:** Draft/rejected movements do not affect stock; quantities and unit conversions are visible; the movement ledger explains the balance.

### Scenario 16 — HDPE supplier part-payment and separate freight

An approved supplier invoice for ₹2,50,000 is recorded. The company pays ₹1,50,000 against that invoice. Separately, the supervisor pays ₹5,000 to a transporter for freight/unloading. The supplier invoice balance is ₹1,00,000 if no other supplier payment/credit exists; the transporter expense remains separate.

**Pass condition:** Supplier due is not incorrectly calculated as ₹95,000 or ₹1,05,000 because unrelated freight was mixed into the invoice ledger.

### Scenario 17 — Supervisor salary and facilities

An admin creates a supervisor compensation record of ₹25,000 per month effective from a date and records company bike, ₹3,000 monthly fuel allowance, room rent, and mobile recharge as separate facility/benefit items. Access is restricted to authorised users.

**Pass condition:** Past compensation is not overwritten when the salary changes; the app distinguishes cash allowance, reimbursement, and company-provided facility.

### Scenario 18 — Site-report timeliness and location evidence

The director dashboard shows whether DPR/DLR was submitted on time. If configured and consented, the app records the report-submission time and one-time location evidence with accuracy. A missing/poor GPS reading is not falsely treated as proof the supervisor was absent or present.

**Pass condition:** Dashboard uses actual submission timestamps; location is purpose-limited and labelled accurately; no continuous tracking is enabled by default.

### Scenario 19 — ₹50,000 petty-cash fund reconciliation

An authorised administrator funds ₹50,000 to a named site custodian. Posted expenses are ₹15,000 worker advance, ₹8,000 diesel/material, and ₹2,000 refreshments/repair. If all are paid from that fund and there are no other movements, the remaining recorded cash is ₹25,000. The custodian confirms physical cash and submits reconciliation.

**Pass condition:** The system balance is movement-derived; a variance requires a reason and review; expenses paid from personal funds do not reduce this fund.

### Scenario 20 — Add a new project type/material and generate an MB export

An authorised admin adds a project type such as Solar Water Pump Installation and material items such as solar panel or submersible pump using master-data screens. A new government-style Measurement Book PDF layout is a software feature, not merely a text setting: it must be developed, tested, versioned, and released through the software delivery process.

**Pass condition:** Admin can add permitted master data without editing source code; a new report engine/format is not falsely presented as implemented until delivered and tested.

---

## 17. Delivery Plan and Milestones

The implementer should deliver in working increments. Do not attempt every screen in one huge pass with untested placeholder code.

### Milestone 1 — Foundation

- Confirm roles, site assignment, permission definitions, approval matrix, languages, minimum Android version, hosting, backup policy, and sensitive-data policy.
- Create repositories, environments, schema migrations, auth flow, navigation shell, design tokens, API conventions, and CI build.
- Provide a simple architecture diagram and setup instructions.

### Milestone 2 — Core site operations

- Project/site master, site assignments, calendar/tasks, DPR, DLR/attendance, workforce list/profile, image uploads, and review flows.
- Implement offline drafts/sync state for agreed field forms.
- Add automated tests and QA evidence.

### Milestone 3 — Materials and issues

- Material catalogue, request/approval, goods receipt, movements/stock, supplier profile, safety/quality issues, and notifications.
- Validate inventory ledger calculations and rescheduling conflicts.

### Milestone 4 — Finance and controls

- Worker payable ledger, invoices, payment allocations, petty cash, reimbursement, compensation/facilities, dynamic permissions, approval queue, audit log, and exports.
- Prioritise financial integrity/security testing over visual polish.

### Milestone 5 — Production hardening and handover

- Cross-role/security testing, offline/retry testing, backup/restore test, performance checks, Play-distribution signing workflow if needed, release documentation, and customer UAT.
- Fix critical/high defects before handover. Document known limitations explicitly.

---

## 18. What the Implementer Must Deliver

1. **Android source code** in a maintainable Git repository, with Kotlin/Compose code and documented modules.
2. **Backend source code** and API definitions, if the backend is separately hosted.
3. **Database migrations** and seed/configuration scripts. Seed data must be clearly identified as demo-only; production must start empty or use client-supplied data.
4. **Development/staging setup guide** and required environment-variable list.
5. **Backend deployment guide** with hosting, secret setup, domain/TLS configuration, database migration, storage configuration, push configuration, and rollback instructions.
6. **APK/AAB build instructions** and a debug APK for client acceptance. Production signing keys remain with the client and are not committed to source control.
7. **API documentation** and an entity/relationship diagram.
8. **QA evidence:** automated test results, manual test matrix, known issues, and the results of role/permission testing.
9. **Backup/restore runbook** and a successful documented restore test.
10. **Handover notes:** all external services, recurring costs, owner accounts, operational procedures, known limitations, and future recommendations.

### Non-negotiable delivery rules

- Do not use hardcoded dummy business records to make the dashboard look populated.
- Do not make buttons decorative. Every visible action must work or be clearly marked disabled/not included.
- Do not claim `payment successful`, `report approved`, `stock updated`, or `sync complete` until the relevant backend operation has actually succeeded.
- Do not expose admin-only data by hiding UI controls while leaving APIs open.
- Do not leave `TODO`, simulated API calls, fake repositories, in-memory-only persistence, or placeholder responses in a production-critical workflow.
- If a requirement cannot be completed, report it as incomplete with the reason and test evidence rather than presenting it as finished.

---

## 19. Decisions Required from JP Infracon Before Production

The implementer can start with sensible development defaults, but these business decisions must be confirmed before production data is entered:

1. Legal company/organisation name and whether multiple legal entities must be supported.
2. Confirmed admin/director accounts and approval delegation policy.
3. Which sites/projects are active and which users can access each one.
4. Direct-purchase limits by role, site, category, transaction amount, and daily/monthly cumulative amount.
5. Who can approve a payment, who can post it, and whether the creator can approve their own request.
6. Whether worker identity documents are required at all, and the reviewed policy for collecting, storing, accessing, retaining, and deleting them.
7. Attendance rules: full/half day, working hours, OT approval, holidays, wage periods, and correction cut-off.
8. Supported wage/contract rates, measurement units, unit conversions, and whether workers may work at multiple sites on the same date.
9. Inventory ownership rules: site stores, central store, minimum stock, negative stock, transfers, physical count frequency, and wastage approval.
10. Supplier invoice fields, tax/retention requirements, payment terms, and the accounting system of record.
11. Petty-cash custody and reconciliation frequency; treatment of personal out-of-pocket expenses.
12. Languages for release: English only or English + Hindi + Odia.
13. Minimum Android version/devices, expected number of users/sites, average photo volume, and hosting/budget limits.
14. Required PDF formats and whether any external department has supplied an approved template for DPR/MB/measurement reports.
15. Data retention, backup frequency, restore objective, support access policy, and incident response contacts.

---

## 20. Final Release Gate

The first production release is accepted only after:

- Business owners approve the workflows and financial definitions.
- All critical acceptance criteria in Section 14 pass.
- Security tests confirm site/role isolation and server-enforced permission checks.
- Inventory, worker payable, supplier payable, and petty-cash calculations reconcile in test cases and sample client-approved ledgers.
- Offline retries and duplicate submissions are verified.
- Backup and restore are tested successfully.
- The client has access to source code, deployment instructions, signing/release process, and service accounts.
- Any remaining limitations are written down and explicitly accepted by the client.

**Product success standard:** a polished interface is necessary, but the application is only production-ready when its persisted records, permissions, balances, evidence, offline behaviour, and audit trail are reliable and testable.

---

## 21. Implementation Instruction for Manus / AI Coding Agent

Use this section together with the complete PRD above. Treat the PRD as the product contract; do not reduce the application to a visual prototype.

### Execution brief

You are the senior Android engineer, backend engineer, database designer, QA engineer, and release engineer for JP Infracon. Build a maintainable, production-oriented construction-management application for real site usage. The native Android client must use Kotlin and Jetpack Compose unless the client explicitly approves a different approach. The backend must persist data in a real database and enforce all access controls and business rules server-side.

### Required execution order

1. Read the whole PRD and create a requirement-to-screen/API/database/test traceability matrix.
2. Identify unresolved decisions from Section 19. Use safe configurable defaults for development, document every assumption, and do not block all progress on non-critical clarifications. Never invent legal approval, client credentials, real company records, or production limits.
3. Design the architecture and entity-relationship diagram. Review the worker-payable, supplier-payable, stock, payment-allocation, and petty-cash calculations before coding those modules.
4. Create a modular Android project, backend project, database migrations, automated build, and development environment. Ensure the project compiles before proceeding to feature work.
5. Implement features in the milestones in Section 17. At the end of each milestone, run tests and report what is actually complete, what remains, and which acceptance criteria passed/failed.
6. Implement authorisation and audit logging before exposing sensitive or financial write endpoints. Test access with users assigned to different sites and roles.
7. Implement server-side transaction posting and stock movement posting using database transactions and idempotency. Do not compute authoritative financial balances only in Android code.
8. Implement offline drafts and a durable sync queue only for the explicitly supported operations. Demonstrate duplicate-safe retry and conflict handling.
9. Seed only clearly labelled development/demo data. Never use demo values as production dashboard values or silently create fictitious client transactions.
10. Run the functional, security, financial-reconciliation, offline, and manual QA matrices. Fix critical/high defects before calling the app ready.
11. Provide source code, migrations, API docs, buildable Android project, debug APK, production release/signing instructions, deployment steps, configuration guide, backup/restore runbook, test results, and known limitations.

### Rules for tool and code use

- Do not stop after generating a plan, UI mockup, or non-running code. Implement and test the actual project within the available environment.
- Do not mark a requirement “done” unless there is implementation evidence and a test or demonstrated workflow.
- Do not use mocked APIs, in-memory repositories, local-only storage, or hardcoded success responses for production workflows. Mocks are permitted only in automated tests or explicitly labelled demo mode.
- Never expose database credentials, service-role keys, signing secrets, or private API credentials in Android source or the APK.
- Do not bypass permissions to make the happy path easier. Use test accounts with explicit roles and grants.
- If a dependency, hosting service, credential, or external integration is unavailable, implement an explicit adapter/interface where sensible, document the blocker, and do not pretend the integration is live.
- Do not silently discard a requirement. Record deferred requirements and reasons in a release-gap report.
- Before final handover, provide a concise completion matrix referencing the relevant PRD section and evidence for each item.

### Final output expected from the coding agent

1. Working Android app source project.
2. Working backend/API source project, if applicable.
3. Database schema migrations and a reproducible setup process.
4. Buildable debug APK and documented signed-release process.
5. Environment template with placeholders only.
6. Architecture diagram, ER diagram, and API documentation.
7. Automated-test and manual-QA results.
8. Deployment, monitoring, backup, restore, and handover guides.
9. A list of incomplete items, known risks, and required client decisions.

**Do not represent the application as production-ready until the acceptance criteria and release gates in this PRD have been verified.**
