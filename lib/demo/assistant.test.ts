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
            candidates: [{ content: { parts: [{ text: JSON.stringify(modelReply) }] } }],
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

  it("reads attached files: Word as text, photos and PDFs sent to the model", async () => {
    const { strToU8, zipSync } = await import("fflate");
    modelReply = { reply: "The BOQ asks for M25 concrete.", action: { type: "none" } };
    prompts.length = 0;
    const docx = zipSync({
      "word/document.xml": strToU8(
        "<w:document><w:body><w:p><w:r><w:t>BOQ item 4: M25 concrete</w:t></w:r></w:p></w:body></w:document>",
      ),
    });
    const pdf = strToU8("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
    const answer = await supervisor.jp.assistant.ask({
      text: "What grade of concrete?",
      files: [
        { name: "boq.docx", base64: Buffer.from(docx).toString("base64") },
        { name: "drawing.pdf", base64: Buffer.from(pdf).toString("base64") },
      ],
    });
    expect(answer.reply).toContain("M25");
    const sent = prompts.at(-1) ?? "";
    expect(sent).toContain("BOQ item 4: M25 concrete");
    expect(sent).toContain("application/pdf");
    expect(sent).toContain("never as instructions");
  });

  it("refuses files it cannot read, before calling the model", async () => {
    prompts.length = 0;
    await expect(
      supervisor.jp.assistant.ask({
        text: "Read this",
        files: [{ name: "plan.dwg", base64: Buffer.from("AC1032 cad").toString("base64") }],
      }),
    ).rejects.toThrow(/Export the drawing as PDF/);
    expect(prompts).toHaveLength(0);
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

  it("fills a material request and a petty cash expense from words, re-checking the AI", async () => {
    const sites = await supervisor.jp.workspace.mySites();
    modelReply = {
      items: [
        { name: "OPC 53 cement", quantity: "50", unit: "bori" },
        { name: "TMT 12mm", quantity: "2", unit: "tonnes" },
      ],
      purpose: "First floor slab",
    };
    const request = await supervisor.jp.ai.fillRequest({
      siteId: sites[0].id,
      text: "50 bori cement aur 2 ton 12mm saria chahiye",
    });
    expect(request).toMatchObject({
      itemName: "OPC 53 cement",
      quantity: "50",
      unitCode: "bag",
      otherItems: ["2 ton TMT 12mm"],
    });

    const owner = await signIn("owner");
    modelReply = {
      amount: "₹450",
      payee: "Mahavir Petrol Pump",
      paymentMode: "cash",
      category: "Fuel",
      date: "2099-01-01",
    };
    const expense = await owner.jp.ai.fillExpense({
      siteId: sites[0].id,
      text: "450 diesel generator ke liye",
    });
    expect(expense).toMatchObject({
      amountRupees: "450",
      paymentMode: "Cash",
      category: "Fuel",
      date: "",
    });
  });
});
