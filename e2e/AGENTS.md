# Browser end to end tests (Playwright)

## Overview

Playwright tests that drive the real web build of the app at a phone viewport. The API is never called: every tRPC request is answered in the browser with typed fake data, so these tests never touch the production database.

## Key files

| File | Owns |
|---|---|
| `trpc-mock.ts` | `mockTrpc(page, handlers)`: answers tRPC batch calls by procedure name with superjson; a procedure with no handler fails with NOT_FOUND. `Outputs` types fakes from `AppRouter`. |
| `serve-export.mjs` | Serves the static export (`dist-web/`), mapping `/finance` to `finance.html`. |
| `../playwright.config.ts` | Pixel 7 project; `webServer` builds the export then serves it on port 8091. |

## Commands

```bash
pnpm test:e2e                        # build the web export, serve it, run all specs
npx playwright test finance          # one spec (reuses a server already on :8091 outside CI)
```

## Conventions

- Name a spec by the flow (`finance-invoice-paging.spec.ts`), not the source file.
- Type every fake with `Outputs["<router>"]["<procedure>"]` so a server shape change breaks the typecheck, not the test at runtime.
- Prefer roles and accessible names (`getByRole("button", { name: "Next page" })`); add a delay in a fake to observe loading states instead of fixed waits in the test.
- Vitest excludes `e2e/**` (`vitest.config.mts`); these specs run only through Playwright.

## Gotchas

- These specs are not in CI yet. `serve-export.mjs` maps a dynamic path such as `/site/<id>` to `site/[id].html`.
- Hidden tab screens stay in the DOM, so assert on text unique to the screen you navigated to.
- Live tests are separate: `e2e-live/` with `playwright.live.config.ts` (`pnpm test:live`) drives the real demo API on :3100 (`LIVE_BASE_URL`), one worker, no fakes. Start `pnpm demo:server` first and delete its database file between runs for fresh sample data.

_Drafted by /sync from the introducing change, worth a quick human pass._
