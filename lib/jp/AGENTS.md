# JP shared domain logic

## Overview

Pure TypeScript rules shared by the mobile client and the API: money and quantity math, workflow policies, schedule impact, and local offline drafts. No database access and no privileged decisions on the client side; the server reuses these and stays the authority.

## Key files

| File | Owns |
|---|---|
| `finance-domain.ts` | Rupee to paise parsing, invoice totals, payment allocation checks |
| `workforce-domain.ts` | Exact paise rates and inclusive effective date ranges |
| `inventory-domain.ts` | Thousandth unit quantities, movement signs, balance rules |
| `petty-cash-policy.ts` | Petty cash rules (fund source attestation, custodian checks, transitions) returning typed errors |
| `account-role-policy.ts` | Which roles an account admin may assign |
| `scheduling.ts` | Date math and dependency impact for rescheduling |
| `domain.ts` | Shared presentation and domain types |
| `local-repository.ts` | AsyncStorage drafts and sync queue, `createClientMutationId` |
| `site-admin-policy.ts` | Site/project status transitions, site-role assignment rules, `prettyRole`, inbox item type and ordering |
| `issue-policy.ts` | Issue categories, severities, transitions, who may close High/Critical, issue codes |
| `issue-drafts.ts` | Offline issue drafts in AsyncStorage and which sync errors are retryable |
| `attachment-policy.ts` | Allowed evidence types, file-signature sniffing, safe names, size formatting |
| `csv.ts` | CSV cells safe from formula injection, UTF-8 BOM, exact paise to rupees |
| `attendance-domain.ts` | Attendance hours (hundredths), estimated earnings in paise, entry validation |
| `selection.ts` | Keeping a chosen site, section, role, or page valid as server data changes (`resolveSelectedId`, `resolveChoice`, `clampPageIndex`) |

## Conventions

- Every module here has a colocated `*.test.ts`. Add or update tests with any rule change; they run in `pnpm test`.
- Money is a string of integer paise (minor units) handled with `BigInt`. Never use `Number` or floats for money.
- Policy functions return a `{ code, message }` error or `null` instead of throwing, so the server can map the code to a `TRPCError`.
- Keep these files free of server imports (`drizzle`, `express`) so they bundle into the app.

## Gotchas

- `local-repository.ts` stores drafts only. A draft is never an approval or an official total; its state is Local Draft, Pending Sync, Synced, Conflict, or Sync Failed.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
