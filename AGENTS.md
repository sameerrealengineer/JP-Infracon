# JP Infracon

Construction management app for field teams (sites, daily reports, tasks, workforce, inventory, supplier invoices and payments, petty cash). Android first, portrait, one handed.

## Stack

- **Language / Runtime**: TypeScript (strict), Node for the API
- **Framework**: Expo SDK 57 with expo-router, React Native 0.86, React 19; Express + tRPC v11 API
- **Key dependencies**: Drizzle ORM over MySQL (`mysql2`), Zod v4, `@tanstack/react-query`, NativeWind (Tailwind), superjson
- **Package manager**: pnpm 9 (use the lockfile)

## Build approach

Tracer Bullet (each feature is built end to end, through schema, server rules, screen, and tests, and works before the next one starts). Source: `docs/scope/index.md`.

## Commands

```bash
pnpm install                 # Install
pnpm dev                     # API on :3000 + Expo Metro web on :8081 (fixed ports)
pnpm check                   # Typecheck (tsc --noEmit)
pnpm lint                    # expo lint (errors fail CI; warnings do not)
pnpm format:check            # Prettier check (pnpm format writes)
pnpm test                    # Vitest, database free tests only
pnpm test:e2e                # Playwright on the static web export, API faked in the browser (see e2e/AGENTS.md)
pnpm demo:server             # Online demo: real API over SQLite sample data + web app on :3100
pnpm test:live               # Playwright against the running demo server (real rules, real data flow)
pnpm build                   # Bundle the API to dist/ with esbuild
pnpm build:server            # Bundle the API into one file (dist-server/index.mjs) for the Docker image
pnpm build:demo-apk          # Offline demo APK on EAS (profile demo); pnpm android:demo builds it locally
npx expo export --platform web --output-dir /tmp/jp-web-export   # Web bundle check
```

A Husky pre commit hook runs lint-staged (`eslint --fix` and Prettier on staged files). GitHub Actions (`.github/workflows/ci.yml`) runs check, lint, format:check, test, and build on every push and pull request.

## Specs

Stored in `docs/specs/`. Format: `docs/specs/NNNN-title.md`. Product requirements: `docs/JP_Infracon_Production_Ready_PRD.md`. Progress and open acceptance criteria: `TODO.md` (authoritative). Design decisions: `plan.md`.

## Rules

- Authorization lives on the server. Every protected procedure resolves site scope and permission there (`server/jp/access.ts`); the client only hides or shows UI from returned capabilities.
- Money is exact integer paise as strings or `BigInt`, never floats. Quantities are exact thousandths. Use the helpers in `lib/jp/*-domain.ts`.
- The server picks final status and derived balances. Never trust a status, total, or balance sent by the client.
- Multi record changes run in one `db.transaction`, with `.for("update")` row locks where balances or versions are checked. Write an `auditEvents` row for every business change.
- Mutations carry a `clientMutationId` for idempotency. Offline drafts live only in AsyncStorage (`lib/jp/local-repository.ts`) and are never shown as approved or posted.
- Screens show real persisted records with honest loading, empty, denied, offline, and error states. No hardcoded names, totals, or fake approvals.
- Import with the `@/` alias (repo root) and `@shared/`. Put pure logic in `lib/jp/` with a colocated `*.test.ts`.
- Never correct state inside `useEffect` (lint error `react-hooks/set-state-in-effect`). Derive the value during render (`lib/jp/selection.ts` keeps a chosen site, role, or page valid) or adjust state while rendering, keyed on the previous value.
- Mark a `TODO.md` outcome done only with evidence the behavior works, not because a screen exists.

## Gotchas

- One managed MySQL database serves both development and production. Never point tests at it, seed demo data, or run destructive cleanup.
- Payments and cash entries are internal ledger records only. Do not add bank or payment execution without explicit permission. Do not publish to Google Play (personal APK only).
- Never put secrets (for example `JP_SUPERADMIN_BOOTSTRAP_SECRET`) in source, logs, chat, or Git. The normal build has no demo logins; the first Super Admin comes from the one time bootstrap flow. Only the offline demo build (below) has built in demo accounts, and they exist only on the phone.
- `react-native-css-interop` is a direct dependency so the web bundle (`expo export`, `pnpm test:e2e`) can resolve NativeWind's `jsx-runtime`; keep it pinned to the version NativeWind uses.
- The React Query cache is persisted to AsyncStorage (`app/_layout.tsx`) so synced records stay viewable offline; sign out calls `queryClient.clear()` so the next user of the phone sees nothing.
- UI text goes through `useT()` from `lib/i18n` (keys are the English text; Hindi and Odia in `lib/i18n/strings.ts`, kept in step by a test). Untranslated text falls back to English.
- Self-hosting: `Dockerfile` + `deploy/docker-compose.yml` (MySQL 8.4, API, Caddy, optional WAHA); guide in `docs/deploy/self-hosting.md`. `pnpm build:server` bundles the API into one file; `RUN_MIGRATIONS=true` applies `drizzle/` on start; `STORAGE_DIR` (disk) or `S3_*` (R2/S3) replaces Manus Forge storage; `PUBLIC_BASE_URL` builds 5-minute `/api/files/:token` links. `scripts/selfhost-smoke.mts` checks a fresh server end to end — never against real data.
- The APK lets the person set the server address on the sign-in screen (`lib/server-address.ts`).
- Errors: `friendlyErrorLink` (`lib/trpc.ts`) turns network/502/HTML failures into one plain translated message on every screen; `app/_layout.tsx` has the root `ErrorBoundary` and `installGlobalErrorReporting()` (`lib/error-reporter.ts`), which send crashes to `jp.feedback.appError` (queued on the phone when offline). Admins read them in App problems (`/app-reports`).
- `/api/health` answers 503 when the database does not answer. On the VM, `scripts/watchdog.sh` (cron every 2 min, installed by `scripts/deploy-azure.sh`) restarts the API after two failed checks and sends WhatsApp to `WATCHDOG_ALERT_PHONE` through OpenWA; it also warns about a full disk or an old backup. The deploy script fails loudly when the API is not healthy within 3 minutes.
- Offline demo build (`EXPO_PUBLIC_JP_DEMO=1`, EAS profile `demo`, `pnpm build:demo-apk`): the app runs the real `server/` router on the phone over SQLite, with seven demo accounts and sample data. No server, no server address on the sign-in screen. Details in `lib/demo/AGENTS.md`.
- `server/_core/`, `lib/_core/`, and the starter components outside `components/jp/` come from the Manus Expo template. Change them only when needed.

## Agent skills

- [expo-overview](.claude/skills/expo-overview/): `expo/skills`, entry point for any Expo task; routes to the other expo skills
- [expo-router](.claude/skills/expo-router/): `expo/skills`, file based routes, stacks, tabs, modals
- [expo-data-fetching](.claude/skills/expo-data-fetching/): `expo/skills`, network calls, React Query, loading, empty, and error states
- [expo-upgrade](.claude/skills/expo-upgrade/): `expo/skills`, SDK upgrades and dependency fixes
- [expo-project-structure](.claude/skills/expo-project-structure/): `expo/skills`, folder layout for new apps only; do not restructure this one
- [vercel-react-native-skills](.claude/skills/vercel-react-native-skills/): `vercel-labs/agent-skills`, React Native performance and component practice
- [styling-nativewind-v4-expo](.claude/skills/styling-nativewind-v4-expo/): `tristanmanchester/agent-skills`, NativeWind v4 with Tailwind v3
- [vitest](.claude/skills/vitest/): `antfu/skills`, writing and running Vitest tests
- [playwright-cli](.claude/skills/playwright-cli/): `microsoft/playwright-cli`, Playwright test authoring and browser automation
- [playwright-best-practices](.claude/skills/playwright-best-practices/): `currents-dev/playwright-best-practices-skill`, e2e patterns, API mocking, flake fixing, CI
- [react-testing-library](.claude/skills/react-testing-library/): `pproenca/dot-skills`, Testing Library queries and hook tests (used with Vitest + jsdom)

MCP servers: Expo MCP (recommended), Drizzle Kit MCP (recommended), Playwright MCP (recommended)

## Context files

- [server/jp/AGENTS.md](server/jp/AGENTS.md) (tRPC business procedures: site scope, permissions, audit, idempotency)
- [lib/jp/AGENTS.md](lib/jp/AGENTS.md) (pure shared domain logic: paise math, policies, scheduling, offline drafts)
- [drizzle/AGENTS.md](drizzle/AGENTS.md) (schema and migrations for the shared MySQL database)
- [e2e/AGENTS.md](e2e/AGENTS.md) (Playwright tests on the static web export with a faked tRPC API)
- [lib/demo/AGENTS.md](lib/demo/AGENTS.md) (offline demo build: real server code on the phone over SQLite, demo accounts, sample data)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
