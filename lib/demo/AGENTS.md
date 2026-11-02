# Offline demo build

## Overview

A build for showing the app with no server: `EXPO_PUBLIC_JP_DEMO=1`. The app answers its own tRPC calls with the real `appRouter` from `server/` (tRPC `unstable_localLink`), on a SQLite database inside the app. Every rule (permissions, maker-checker, ledgers, audit) is the same code the API runs. Normal builds do not include any of this.

## How it fits together

| File | Owns |
|---|---|
| `config.ts` | `DEMO_MODE`, the seven demo accounts and their shared password |
| `backend.ts` | `createDemoLink` (replaces `link.ts` in demo builds), first launch setup |
| `link.ts` | Stub for normal builds; `metro.config.js` swaps it for `backend.ts` |
| `sql/translate.ts` | MySQL text from Drizzle to SQLite (`default` values, `FIELD`, `IF`, `ON DUPLICATE KEY`, row locks, `onUpdateNow`), results back as MySQL style text |
| `sql/ddl.ts` | SQLite tables and unique indexes built from `drizzle/schema.ts` |
| `sql/engine.ts` | Drizzle `mysql-proxy` database over a `SqlDriver`, with BEGIN/COMMIT transactions |
| `sql/driver.native.ts` | expo-sqlite on the phone (`driver.ts` refuses on web) |
| `server/db.ts`, `server/sdk.ts`, `server/storage.ts` | Stand ins for `server/db.ts`, `server/_core/sdk.ts`, `server/storage.ts` |
| `shims/crypto.ts` | Stand in for `node:crypto` (SHA-256, random ids, a light password hash) |
| `polyfills.ts` | `Buffer`, and timestamp parsing that does not depend on Hermes `Date` parsing |
| `seed.ts`, `seed-business.ts` | Sample data, created through the real procedures as the right role |

## Commands

```bash
pnpm vitest run lib/demo                # backend tests on Node's built in SQLite
EXPO_PUBLIC_JP_DEMO=1 npx expo export --platform android --output-dir /tmp/jp-demo   # bundle check
pnpm build:demo-apk                     # APK on EAS (profile demo)
```

## Conventions

- Change server behaviour in `server/`, never here; the demo picks it up. Add a swap in `metro.config.js` only for a module that needs a server machine.
- New sample data goes through a procedure call in `seed-business.ts`, made by the role that would do it, so it passes the same rules.
- Tests mock the same three modules with `vi.mock` and use `testing/node-driver.ts`.

## Gotchas

- One connection: work started while a transaction is open joins it (no lock, which would freeze). Fine for one person on one phone.
- SQLite returns decimals without trailing zeros (`12.5`, MySQL gives `12.500`); sums are trimmed to 6 decimals.
- AI bill scan and voice need API keys and a network, so they report "not configured" in the demo. WhatsApp, SMS and push alerts are not sent.
- Data lives in `jp-infracon-demo.db` on the phone. Clearing the app's storage starts the demo afresh. Each phone has its own data.
- The demo password is in source on purpose. Never reuse it, or this mechanism, for the real build.
