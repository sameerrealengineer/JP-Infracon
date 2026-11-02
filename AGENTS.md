# JP Infracon

Construction management app for field teams (sites, daily reports, tasks, workforce, inventory, supplier invoices and payments, petty cash). Android first, portrait, one handed.

## Stack

- **Language / Runtime**: TypeScript (strict), Node for the API
- **Framework**: Expo SDK 57 with expo-router, React Native 0.86, React 19; Express + tRPC v11 API
- **Key dependencies**: Drizzle ORM over MySQL (`mysql2`), Zod v4, `@tanstack/react-query`, NativeWind (Tailwind), superjson
- **Package manager**: pnpm 9 (use the lockfile)

## Build approach

<TBD, set by /scope>

## Commands

```bash
pnpm install                 # Install
pnpm dev                     # API on :3000 + Expo Metro web on :8081 (fixed ports)
pnpm check                   # Typecheck (tsc --noEmit)
pnpm lint                    # expo lint
pnpm test                    # Vitest, database free tests only
pnpm build                   # Bundle the API to dist/ with esbuild
npx expo export --platform web --output-dir /tmp/jp-web-export   # Web bundle check
```

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
- Mark a `TODO.md` outcome done only with evidence the behavior works, not because a screen exists.

## Gotchas

- One managed MySQL database serves both development and production. Never point tests at it, seed demo data, or run destructive cleanup.
- Payments and cash entries are internal ledger records only. Do not add bank or payment execution without explicit permission. Do not publish to Google Play (personal APK only).
- Never put secrets (for example `JP_SUPERADMIN_BOOTSTRAP_SECRET`) in source, logs, chat, or Git. There are no demo logins; the first Super Admin comes from the one time bootstrap flow.
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

MCP servers: Expo MCP (recommended), Drizzle Kit MCP (recommended)

## Context files

- [server/jp/AGENTS.md](server/jp/AGENTS.md) (tRPC business procedures: site scope, permissions, audit, idempotency)
- [lib/jp/AGENTS.md](lib/jp/AGENTS.md) (pure shared domain logic: paise math, policies, scheduling, offline drafts)
- [drizzle/AGENTS.md](drizzle/AGENTS.md) (schema and migrations for the shared MySQL database)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
