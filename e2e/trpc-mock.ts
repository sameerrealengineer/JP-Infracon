import type { Page, Route } from "@playwright/test";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { deserialize, serialize } from "superjson";
import type { AppRouter } from "@/server/routers";

export type Outputs = inferRouterOutputs<AppRouter>;
export type Inputs = inferRouterInputs<AppRouter>;

/** A fake answer for one procedure: a value, or a function of the call's input. Throw to fail the call. */
type Handler = (input: unknown) => unknown | Promise<unknown>;
export type TrpcHandlers = Record<string, Handler>;

/**
 * Answers every tRPC batch call from the app in the browser, so e2e tests never reach a real API or the
 * shared database. Procedures without a handler fail with NOT_FOUND, which makes a missing fake obvious.
 */
export async function mockTrpc(page: Page, handlers: TrpcHandlers) {
  await page.route("**/api/trpc/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const names = decodeURIComponent(url.pathname.split("/api/trpc/")[1] ?? "").split(",");
    const rawInput = url.searchParams.get("input") ?? route.request().postData() ?? "{}";
    const batchInput = JSON.parse(rawInput) as Record<string, { json?: unknown; meta?: never }>;

    const results = await Promise.all(
      names.map(async (name, index) => {
        const handler = handlers[name];
        if (!handler) return trpcError(name, "NOT_FOUND", `No fake answer for ${name}`);
        const entry = batchInput[String(index)];
        const input = entry ? deserialize(entry as Parameters<typeof deserialize>[0]) : undefined;
        try {
          return { result: { data: serialize(await handler(input)) } };
        } catch (error) {
          return trpcError(
            name,
            "INTERNAL_SERVER_ERROR",
            error instanceof Error ? error.message : String(error),
          );
        }
      }),
    );
    const failed = results.some((item) => "error" in item);
    await route.fulfill({
      status: failed ? (names.length > 1 ? 207 : 500) : 200,
      contentType: "application/json",
      body: JSON.stringify(results),
    });
  });
}

function trpcError(path: string, code: string, message: string) {
  return {
    error: serialize({ message, code: -32603, data: { code, httpStatus: 500, path } }),
  };
}
