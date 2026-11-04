# Database schema and migrations

## Overview

Drizzle schema and SQL migration history for the single managed MySQL database. That database is shared by development and production, so every change here is a production change.

## Key files

| File | Owns |
|---|---|
| `schema.ts` | All tables (users, organisations, sites, grants, reports, tasks, workforce, inventory, finance, petty cash, `auditEvents`) |
| `relations.ts` | Drizzle relations |
| `NNNN_*.sql` | Generated migrations, applied in order |
| `meta/` | Drizzle snapshots and `_journal.json`; never edit by hand |

## Commands

```bash
pnpm db:push   # drizzle-kit generate + migrate; needs DATABASE_URL and hits the shared database
```

## Conventions

- Change `schema.ts`, then generate a migration. Keep migrations additive (new tables or columns); review the SQL before applying it.
- Use normalized tables for core records, not JSON blobs. Business status and ledger values are set by the server.
- Historical creator columns may be nullable where the original value was never recorded.

## Gotchas

- At the 2 November 2026 handoff the shared database had migrations through 0009. Migrations 0010 (petty cash tables) and 0011 (expense attestation, task snapshots) were not applied. Check before assuming they exist, and ask before applying.
- Migration 0012 (`site_issues`, `site_issue_events`, additive) was generated on 2 November 2026 and is not applied. The Issues screens and exports need it; the inbox skips sections whose tables are missing.
- Migration 0013 (additive, new tables only: delegations, delegation_grants, registration_invites, push_devices, notification_deliveries, user_contact_preferences, site_geofences, attachment_locations, site_presence_events) is generated and not applied. Code that reads these tables catches a missing table so older screens keep working; new columns are never added to existing hot tables (users, sites, permission_grants, attachments) for that reason.
- Migration 0014 (3 November 2026) changes the daily report unique key to include `reportKind` (adds the new key, then drops the old one) so a DPR and a DLR for the same site, day and shift can both exist. Migration 0015 adds `project_documents`, `project_document_versions` and `document_chunks` (new tables only). Both were applied on the Azure server on 3 November 2026 after a backup. Migration 0016 adds `project_budgets` and `project_budget_lines` (new tables only). Migration 0017 adds `user_profiles`, `organization_settings` and a nullable `coverAttachmentId` on `projects` and `sites`; the offline demo adds missing nullable columns to older phone databases on start (`lib/demo/sql/ddl.ts`). Take a backup before applying.
- Migration 0018 (4 November 2026) adds `person_details` and `person_feedback`; 0019 adds `alert_rules` and `user_alert_mutes`; 0020 adds `whatsapp_bot_messages`; 0021 adds CRM and billing tables (`crm_clients`, `crm_leads`, `crm_activities`, `quotations`, `quotation_lines`, `project_contracts`, `contract_items`, `client_bills`, `client_bill_lines`, `client_receipts`); 0022 adds purchase tables (`purchase_orders`, `purchase_order_lines`, `purchase_order_quotes`, `goods_receipts`, `goods_receipt_lines`, `purchase_invoice_links`). New tables only, not applied anywhere yet. Code reading them catches a missing table. Generate migrations offline with a dummy `DATABASE_URL` (generate does not connect).
- Do not run `pnpm db:push` casually: it generates and migrates against the shared database in one step.
- `RUN_MIGRATIONS=true` (`server/_core/migrate.ts`) applies every pending migration in `drizzle/` when the API starts. Use it only on a self hosted database you have backed up; never with `DATABASE_URL` pointing at the shared database.
- The database exposes no CHECK constraints, so value rules live in the API.

## Agent skills

- [drizzle-orm-patterns](../.claude/skills/drizzle-orm-patterns/): `giuseppe-trisciuoglio/developer-kit`, Drizzle schema, queries, relations, transactions, migrations
- [mysql](../.claude/skills/mysql/): `planetscale/database-skills`, MySQL schema, indexing, locking, and migration review

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
