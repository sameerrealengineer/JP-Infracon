# Epic: Finance

Limits, petty cash, reimbursements, supplier invoices and payments, worker pay, and procurement. Every entry is an internal ledger record, never a bank or UPI transfer. Part of the [JP Infracon scope](index.md).

## Existing

### 7. Supplier payment ledger · existing
Internal supplier payments allocated in exact paise across approved same supplier invoices, creator submission, different person review and post, reasoned transitions, idempotent posting, audit (migration 0009). Advances, notes, and reversals are planned in feature 30. code in `server/jp/supplier-payments.ts`, `components/jp/supplier-payment-ledger.tsx`

## Slice 1: First field release

### 18. Approval limits & maker checker policy · needs a decision · GA
Let admins configure per action, per period, category, and vendor limits, evidence rules, and when two different people must approve. Over limit actions route to approval, and splitting requests cannot get around a limit.
**Done when:** an admin sets a limit without code changes, an over limit petty cash or payment entry routes to approval, split requests are caught, and no amount like 25,000 or 50,000 is hardcoded.
- [ ] Design it (spec): `/architect approval limits & maker checker policy`

### 19. Petty cash ledger · in-progress · GA
Site funds with custodian acknowledgement, funding, expense, and linked cash return movements, derived balances, limits, and audit exist (migrations 0010 and 0011, not yet applied to the shared database). Still open: physical cash count reconciliation with approved variances, and receipt files using feature 12.
**Done when:** a custodian counts cash against the ledger, each variance needs a reason and approval, receipts attach privately or carry a reason when missing, and the PRD example (50,000 minus 15,000, 8,000, 2,000 equals 25,000) reconciles.
- [ ] Design it (spec): `/architect petty cash ledger`
code in `server/jp/petty-cash.ts`, `lib/jp/petty-cash-policy.ts`, `components/jp/petty-cash-ledger.tsx`

### 20. Supervisor reimbursements · needs a decision · GA
When a supervisor pays from their own pocket, record a separately reviewed reimbursement claim owed to them, never a reduction of site petty cash.
**Done when:** a personal expense creates a claim, a reviewer approves it, settlement links back to the claim, and site petty cash is unchanged by the personal outlay.
- [ ] Design it (spec): `/architect supervisor reimbursements`

## Slice 2: Worker pay

### 26. Worker payables & advances · needs a decision · GA
Derive what each worker is owed from approved attendance and measurements, effective rate snapshots, posted payments, and approved adjustments. No typed balance is ever authoritative.
**Done when:** earned, paid, outstanding, advance, and disputed amounts show separately, and the PRD example (3,000 earned, 1,500 advance, 1,500 outstanding) holds with the advance counted once.
- [ ] Design it (spec): `/architect worker payables & advances`

### 27. Supervisor compensation records · needs a decision · GA
Supervisor salary, benefits, and facilities in restricted, effective dated records, not generic user fields.
**Done when:** only authorised finance roles can view or change a supervisor's compensation, and every change keeps its effective date and audit history.
- [ ] Design it (spec): `/architect supervisor compensation records`

## Slice 3: Supplier and stock depth

### 28. Supplier invoices · in-progress · GA
Supplier records and site invoices with server derived paise totals and reviewed states exist (migration 0007). Still open: correcting or cancelling a draft, and private invoice files using feature 12.
**Done when:** a creator can correct or cancel a draft with an audit trail, invoice files attach privately, and approved files are never silently replaced.
- [ ] Design it (spec): `/architect supplier invoices`
code in `server/jp/finance.ts`, `lib/jp/finance-domain.ts`, `app/finance.tsx`

### 29. Procurement & delivery receipts · needs a decision
Purchase and receipt records that invoices and stock inward link to, replacing today's free text references. Receiving goods never approves or pays an invoice by itself.
**Done when:** an invoice links to a real purchase and receipt, and a receipt with rejected quantities does not raise payable or stock.
- [ ] Design it (spec): `/architect procurement & delivery receipts`

### 30. Supplier advances, notes, retention & reversals · needs a decision · GA
Supplier advances, credit and debit notes, retention, and reversals as linked compensating entries. Posted rows are never deleted.
**Done when:** supplier due equals approved invoices minus posted allocations plus or minus approved notes, and a reversal creates a linked entry instead of editing history.
- [ ] Design it (spec): `/architect supplier advances, notes, retention & reversals`

### 31. Transporter freight expenses · needs a decision · GA
Freight as its own payable to the transporter, not reducing a material supplier's invoice unless explicitly linked.
**Done when:** a freight charge records against the transporter and leaves the material supplier's due unchanged unless an allocation links them.
- [ ] Design it (spec): `/architect transporter freight expenses`
