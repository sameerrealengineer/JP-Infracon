import { afterEach, describe, expect, it, vi } from "vitest";

// Gemini often answers "503 high demand" for a moment; AI features must retry, then use the
// next model, then Sarvam for text, instead of failing at once.
const { aiJson, geminiJson, geminiModels, AI_DEADLINE_MS } = await import("../../server/jp/ai");

const ok = (value: unknown) =>
  new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }),
    { status: 200 },
  );
const busy = () =>
  new Response(
    JSON.stringify({ error: { message: "This model is currently experiencing high demand." } }),
    {
      status: 503,
    },
  );

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
  delete process.env.SARVAM_API_KEY;
  delete process.env.GEMINI_MODEL;
});

describe("AI resilience", () => {
  it("tries the configured model, then the fallbacks", () => {
    process.env.GEMINI_MODEL = "gemini-3.5-flash";
    expect(geminiModels()).toEqual(["gemini-3.5-flash", "gemini-flash-latest", "gemini-2.5-flash"]);
  });

  it("retries a busy model, then answers", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.GEMINI_MODEL = "gemini-3.5-flash";
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return calls.length === 1 ? busy() : ok({ ok: true });
    });
    expect(await geminiJson([{ text: "hi" }], {})).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it("moves to the next model when one stays busy or is missing", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.GEMINI_MODEL = "gemini-3.5-flash";
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("gemini-3.5-flash")) return busy();
      if (String(url).includes("gemini-flash-latest")) return new Response("{}", { status: 404 });
      return ok({ read: "red" });
    });
    expect(await geminiJson([{ text: "hi" }], {})).toEqual({ read: "red" });
    expect(calls.filter((u) => u.includes("gemini-3.5-flash"))).toHaveLength(2);
    expect(calls.at(-1)).toContain("gemini-2.5-flash");
  });

  it("a rejected key stops at once with the reason", async () => {
    process.env.GEMINI_API_KEY = "bad";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 }),
    );
    await expect(geminiJson([{ text: "hi" }], {})).rejects.toThrow(/API key not valid/);
  });

  it("text requests fall back to Sarvam when Gemini keeps failing; photos do not", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.SARVAM_API_KEY = "s";
    vi.stubGlobal("fetch", async (url: string) =>
      String(url).includes("sarvam")
        ? new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify({ from: "sarvam" }) } }],
            }),
            { status: 200 },
          )
        : busy(),
    );
    expect(await aiJson([{ text: "make a report" }], {}, { system: "s", text: "t" })).toEqual({
      from: "sarvam",
    });
    await expect(
      aiJson(
        [{ text: "read" }, { image: { data: "AAAA", mimeType: "image/png" } }],
        {},
        {
          system: "s",
          text: "t",
        },
      ),
    ).rejects.toThrow(/busy/);
  }, 30_000);

  it("asks for no thinking on text and a little on photos", async () => {
    process.env.GEMINI_API_KEY = "k";
    const budgets: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      budgets.push(JSON.parse(String(init.body)).generationConfig.thinkingConfig?.thinkingBudget);
      return ok({ ok: true });
    });
    await geminiJson([{ text: "fill the form" }], {});
    await geminiJson([{ text: "read" }, { image: { data: "AAAA", mimeType: "image/png" } }], {});
    expect(budgets).toEqual([0, 1024]);
  });

  it("asks the same model again without thinking when it refuses that setting", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.GEMINI_MODEL = "gemini-old-flash";
    const sent: boolean[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const thinking = Boolean(JSON.parse(String(init.body)).generationConfig.thinkingConfig);
      sent.push(thinking);
      return thinking
        ? new Response(JSON.stringify({ error: { message: "Thinking is not supported" } }), {
            status: 400,
          })
        : ok({ fine: 1 });
    });
    expect(await geminiJson([{ text: "hi" }], {})).toEqual({ fine: 1 });
    expect(sent).toEqual([true, false]);
  });

  it("gives up within the deadline instead of trying every model for minutes", async () => {
    process.env.GEMINI_API_KEY = "k";
    let clock = 0;
    let calls = 0;
    // Each busy answer takes 20 s of (fake) time.
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      clock += 20_000;
      return busy();
    });
    await expect(geminiJson([{ text: "hi" }], {}, () => clock)).rejects.toThrow(/within 45 s/);
    expect(calls).toBe(3);
    expect(clock).toBeLessThanOrEqual(AI_DEADLINE_MS.text + 20_000);
  }, 30_000);
});
