import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The assistant over the demo SQLite database, with the AI model replaced by a fake reply.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
let supervisor: Caller;
let modelReply: unknown = {};
const prompts: string[] = [];
const realFetch = globalThis.fetch;

describe("assistant", () => {
  beforeAll(async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("generativelanguage.googleapis.com")) {
        prompts.push(String(init?.body ?? ""));
        return new Response(
          JSON.stringify({
            steps: [
              {
                type: "model_output",
                content: [{ type: "text", text: JSON.stringify(modelReply) }],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return realFetch(url, init);
    });
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    supervisor = await signIn("supervisor");
  }, 120_000);

  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
  });

  it("answers from the person's own sites and offers a report draft", async () => {
    modelReply = {
      reply: "Theek hai, report ka draft khol raha hoon.",
      action: { type: "draft_report", reportKind: "DPR", text: "120 sqft plaster first floor" },
    };
    const answer = await supervisor.jp.assistant.ask({
      text: "First floor pe 120 sqft plaster hua, report bana do",
    });
    expect(answer.reply).toContain("draft");
    expect(answer.action).toMatchObject({ type: "draft_report", reportKind: "DPR" });
    expect(answer.action.type === "draft_report" && answer.action.route).toContain(
      "/report-editor?",
    );
    const sites = await supervisor.jp.workspace.mySites();
    expect(prompts.at(-1)).toContain(sites[0].name);
    expect(prompts.at(-1)).not.toContain("budget: Project budget");
  });

  it("drops actions the person's role does not allow", async () => {
    modelReply = { reply: "Opening finance.", action: { type: "open", screen: "budget" } };
    const answer = await supervisor.jp.assistant.ask({ text: "show the budget" });
    expect(answer.action).toEqual({ type: "none" });
  });
});
