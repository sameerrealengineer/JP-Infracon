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
| `tasks.ts` | Tasks, Finish to Start dependencies, rescheduling with impact preview |
| `workforce.ts` | Workers, KYC review, effective dated rates |
| `inventory.ts` | Catalogue, stock movements, derived stock |
| `finance.ts` | Suppliers and invoices; mounts `supplier-payments.ts` and `petty-cash.ts` |

## Conventions

- Start every procedure with `protectedProcedure` and call `getSiteScope(ctx.user, siteId, "<permission.key>")` before touching data. Keys ending in `.view` are read only and still work on inactive sites; any other key requires an Active site.
- A new permission key goes in `permissionKeys` in `router.ts` and in the role mapping in `policy.ts`, so the client capabilities stay in sync.
- Throw `TRPCError` with a plain, user readable message. Use `PRECONDITION_FAILED` when the database is unavailable (`requireDb`).
- Mutations take `clientMutationId` (16 to 64 chars). On retry, look up the prior `auditEvents` row by actor and mutation id and return the same result instead of writing twice.
- Changes that touch several rows run in `db.transaction`, lock the rows they check with `.for("update")`, and insert an `auditEvents` row (action, entity, before and after summary, reason).
- Status transitions are maker checker: a different user reviews, and rejections or cancellations need a reason. The server sets the final status.
- Keep pure rules in `lib/jp/` so they can be unit tested without a database.

## Gotchas

- The database has no CHECK constraints. Positive amounts, date ordering, and non negative balances are enforced only here; do not claim the database enforces them.
- Supplier payment posting and petty cash entries are app ledger events, not bank transfers.
- Petty cash Expense entries require the site fund attestation; Personal Funds are rejected until the reimbursement workflow exists. Task labels on cash movements are snapshots, so later task edits do not rewrite history.
- Tests here (`policy.test.ts`) are database free. Do not write tests that hit the shared database.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
