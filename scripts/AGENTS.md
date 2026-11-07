# Server and demo scripts

## Overview

Scripts for running the production server on the Azure VM (deploy, watchdog, WhatsApp setup, AI checks, a full reset) and for the demo server and app audit. The `.sh` files reach the VM over SSH (`JP_DEPLOY_HOST`, default `jpadmin@jpinfracon.centralindia.cloudapp.azure.com`), so running one changes production.

## Key files

| File | Owns |
|---|---|
| `deploy-azure.sh` | Deploy HEAD: refuses uncommitted changes, backs up the database first (stops if the backup looks empty), `git archive HEAD` to `~/jp-infracon`, `docker compose up -d --build` (migrations apply on start), waits up to 3 minutes for `/api/health`, installs the watchdog cron |
| `reset-production-db.sh` | Wipes and recreates the production `jp_infracon` database after a backup and a typed confirmation phrase; uploaded files are kept |
| `watchdog.sh` | Cron every 2 minutes on the VM: health check, restart after 2 failures, WhatsApp alert to `WATCHDOG_ALERT_PHONE`, disk and backup age warnings |
| `setup-openwa.sh` | Starts OpenWA (compose profile `openwa`), links the sending WhatsApp number by pairing code, writes `OPENWA_*` into `deploy/.env` |
| `setup-whatsapp-bot.sh` | Turns the WhatsApp bot on or off (webhook secret, `WHATSAPP_BOT=on`); run after `setup-openwa.sh` |
| `check-ai.sh` | Checks AI, voice, bill scan and document upload dependencies on the live server |
| `selfhost-smoke.mts` | End to end check of a fresh self hosted server; it creates records |
| `demo-server.ts`, `build-demo-server.mjs` | Online demo: real API over SQLite sample data plus the web app (`pnpm demo:server`), with server modules swapped for `lib/demo` versions |
| `audit-app.mjs` | Walks every screen as each demo role and records errors (`pnpm audit:app`) |
| `load-env.js`, `generate_qr.mjs` | From the Manus template: env loading and an Expo QR code |

## Commands

```bash
bash scripts/deploy-azure.sh    # deploy the committed HEAD to production
bash scripts/check-ai.sh        # check AI keys and providers on the live server
pnpm demo:server                # online demo on :3100
pnpm audit:app [url] [outDir]   # screen audit against the demo server
```

## Conventions

- Scripts print only yes/no or status codes for secrets; never echo `deploy/.env` values, keys, or tokens. Log output is filtered for `key|secret|password|token`.
- Any script that changes the production database takes a backup first and stops when the backup fails or looks empty.
- Write header comments in plain words: what the script does, how to run it, and its numbered steps.

## Gotchas

- `reset-production-db.sh` deletes every production record. Run it only when you explicitly ask for a fresh start.
- `selfhost-smoke.mts` writes test records. Never point it at a server with real company data.
- The VM has no git; code arrives as `git archive HEAD`, so only committed changes deploy.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
