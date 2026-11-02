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
- Do not run `pnpm db:push` casually: it generates and migrates against the shared database in one step.
- The database exposes no CHECK constraints, so value rules live in the API.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
