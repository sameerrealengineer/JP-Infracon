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
Site funds with custodian acknowledgement, funding, expense and linked cash return movements, derived balances, limits, receipts through feature 12, AI expense fill, and audit (migrations 0010 and 0011, now on production). Still open: physical cash count reconciliation with approved variances.
**Done when:** a custodian counts cash against the ledger, each variance needs a reason and approval, receipts attach privately or carry a reason when missing, and the PRD example (50,000 minus 15,000, 8,000, 2,000 equals 25,000) reconciles.
- [x] Build the first version (shipped before a spec; see `TODO.md` increments 2 to 6 November)
- [ ] Verify it: `/check verify petty cash ledger`
- [ ] Design the open items (spec): `/architect petty cash ledger`
- [ ] Test it: `/test petty cash ledger`
- [ ] Review and document it: `/check review petty cash ledger`, then `/document`
code in `server/jp/petty-cash.ts`, `lib/jp/petty-cash-policy.ts`, `components/jp/petty-cash-ledger.tsx`

### 20. Supervisor reimbursements · needs a decision · GA
When a supervisor pays from their own pocket, record a separately reviewed reimbursement claim owed to them, never a reduction of site petty cash.
**Done when:** a personal expense creates a claim, a reviewer approves it, settlement links back to the claim, and site petty cash is unchanged by the personal outlay.
- [ ] Design it (spec): `/architect supervisor reimbursements`

## Slice 2: Worker pay

### 26. Worker payables & advances · in-progress · GA
Worker khaata: advances and repayments with maker checker, recovered once through pay runs (installment suggested and capped), and paid, due and advance per person from approved attendance. Still open: disputed amounts, and measurements feeding worker pay.
**Done when:** earned, paid, outstanding, advance, and disputed amounts show separately, and the PRD example (3,000 earned, 1,500 advance, 1,500 outstanding) holds with the advance counted once.
- [x] Build the first version (shipped before a spec; see `TODO.md` increment 5 November (b))
- [ ] Verify it: `/check verify worker payables & advances`
- [ ] Design the open items (spec): `/architect worker payables & advances`
- [ ] Test it: `/test worker payables & advances`
- [ ] Review and document it: `/check review worker payables & advances`, then `/document`
code in `server/jp/advances.ts`, `lib/jp/advance-domain.ts`, `app/khaata.tsx`

### 27. Supervisor compensation records · in-progress · GA
Payroll profiles hold monthly salary and PF/ESI/PT membership, approved by a different person, behind `payroll.*` permissions (feature 40). Still open: benefits and facilities, and a check that only finance roles can see them.
**Done when:** only authorised finance roles can view or change a supervisor's compensation, and every change keeps its effective date and audit history.
- [x] Build the first version (shipped before a spec; see `TODO.md` increment 5 November)
- [ ] Verify it: `/check verify supervisor compensation records`
- [ ] Design the open items (spec): `/architect supervisor compensation records`
- [ ] Test it: `/test supervisor compensation records`
- [ ] Review and document it: `/check review supervisor compensation records`, then `/document`
code in `server/jp/payroll.ts`, `app/payroll.tsx`

## Slice 3: Supplier and stock depth

### 28. Supplier invoices · in-progress · GA
Supplier records and invoices with server derived paise totals, reviewed states, private invoice files, AI bill scan into an editable draft, and matching to purchase receipts. Still open: correcting or cancelling a draft with an audit trail.
**Done when:** a creator can correct or cancel a draft with an audit trail, invoice files attach privately, and approved files are never silently replaced.
- [x] Build the first version (shipped before a spec; see `TODO.md` increments 2 November (b) and (c))
- [ ] Verify it: `/check verify supplier invoices`
- [ ] Design the open items (spec): `/architect supplier invoices`
- [ ] Test it: `/test supplier invoices`
- [ ] Review and document it: `/check review supplier invoices`, then `/document`
code in `server/jp/finance.ts`, `lib/jp/finance-domain.ts`, `app/finance.tsx`, `app/scan-bill.tsx`

### 29. Procurement & delivery receipts · in-progress
Purchase orders with competing quotes, maker checker approval, goods receipts with rejection reasons that post only accepted material to stock, and three way matching against supplier bills. Still open: check that receiving never approves or pays an invoice by itself.
**Done when:** an invoice links to a real purchase and receipt, and a receipt with rejected quantities does not raise payable or stock.
- [x] Build the first version (shipped before a spec; see `TODO.md` ERP slice 2)
- [ ] Verify it: `/check verify procurement & delivery receipts`
- [ ] Design the open items (spec): `/architect procurement & delivery receipts`
- [ ] Test it: `/test procurement & delivery receipts`
code in `server/jp/purchase.ts`, `lib/jp/purchase-domain.ts`, `app/purchase.tsx`

### 30. Supplier advances, notes, retention & reversals · needs a decision · GA
Supplier advances, credit and debit notes, retention, and reversals as linked compensating entries. Posted rows are never deleted.
**Done when:** supplier due equals approved invoices minus posted allocations plus or minus approved notes, and a reversal creates a linked entry instead of editing history.
- [ ] Design it (spec): `/architect supplier advances, notes, retention & reversals`

### 31. Transporter freight expenses · needs a decision · GA
Freight as its own payable to the transporter, not reducing a material supplier's invoice unless explicitly linked.
**Done when:** a freight charge records against the transporter and leaves the material supplier's due unchanged unless an allocation links them.
- [ ] Design it (spec): `/architect transporter freight expenses`
