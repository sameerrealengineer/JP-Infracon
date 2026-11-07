import { describe, expect, it } from "vitest";
import {
  nextVoiceTurn,
  replyLanguage,
  startVoiceTurn,
  type VoiceTurnDecision,
  splitForSpeech,
  rmsDb,
} from "./voice-turn";

/** Runs a list of [ms since start, dB] samples and returns each decision. */
function run(samples: [number, number | null][]) {
  let state = startVoiceTurn(0);
  const decisions: VoiceTurnDecision[] = [];
  for (const [at, db] of samples) {
    const result = nextVoiceTurn(state, db, at);
    state = result.state;
    decisions.push(result.decision);
  }
  return decisions;
}

const span = (from: number, to: number, db: number) => {
  const out: [number, number][] = [];
  for (let at = from; at <= to; at += 150) out.push([at, db]);
  return out;
};

describe("voice turn", () => {
  it("ends the turn after speech followed by a pause", () => {
    const decisions = run([
      ...span(0, 450, -70),
      ...span(600, 2400, -25),
      ...span(2550, 4200, -70),
    ]);
    expect(decisions).toContain("speaking");
    expect(decisions.at(-1)).toBe("done");
    // Not before the pause is long enough.
    expect(run([...span(0, 1500, -25), ...span(1650, 2100, -70)]).at(-1)).toBe("speaking");
  });

  it("ignores a short click and goes idle when nobody speaks", () => {
    const decisions = run([[0, -70], [150, -10], [300, -70], ...span(450, 9300, -70)]);
    expect(decisions).not.toContain("done");
    expect(decisions.at(-1)).toBe("idle");
  });

  it("stops a very long turn and treats missing levels as quiet", () => {
    expect(run(span(0, 28_200, -20)).at(-1)).toBe("done");
    expect(
      run([
        [0, null],
        [150, null],
      ]).at(-1),
    ).toBe("listening");
  });

  it("answers aloud in the detected language when it can", () => {
    expect(replyLanguage("od-IN", "en-IN")).toBe("od-IN");
    expect(replyLanguage("or-IN", "en-IN")).toBe("od-IN");
    expect(replyLanguage("ta-IN", "hi-IN")).toBe("hi-IN");
    expect(replyLanguage(null, "en-IN")).toBe("en-IN");
  });
});

describe("splitForSpeech", () => {
  it("speaks the first full sentence first", () => {
    expect(
      splitForSpeech("Pakalapoli site is 42% done. Plan says 50%. Two tasks are late."),
    ).toEqual({
      first: "Pakalapoli site is 42% done.",
      rest: "Plan says 50%. Two tasks are late.",
    });
  });
  it("handles Hindi and Odia full stops", () => {
    const split = splitForSpeech("आज 12 लोग हाज़िर हैं, कल से दो ज़्यादा। बाकी सब ठीक है।");
    expect(split.first).toBe("आज 12 लोग हाज़िर हैं, कल से दो ज़्यादा।");
    expect(split.rest).toBe("बाकी सब ठीक है।");
  });
  it("keeps a short reply whole", () => {
    expect(splitForSpeech("Haan.")).toEqual({ first: "Haan.", rest: "" });
  });
  it("cuts a very long sentence at a space", () => {
    const long = "word ".repeat(80).trim();
    const split = splitForSpeech(long);
    expect(split.first.length).toBeLessThanOrEqual(220);
    expect(`${split.first} ${split.rest}`).toBe(long);
  });
});

describe("rmsDb", () => {
  it("gives -160 for silence and about 0 dB for a full-scale signal", () => {
    expect(rmsDb([])).toBe(-160);
    expect(rmsDb([0, 0, 0])).toBe(-160);
    expect(rmsDb([1, -1, 1, -1])).toBeCloseTo(0, 5);
  });
  it("speech-level samples land above the speech threshold, room noise below", () => {
    expect(rmsDb(Array.from({ length: 512 }, (_, i) => 0.1 * Math.sin(i / 3)))).toBeGreaterThan(
      -42,
    );
    expect(rmsDb(Array.from({ length: 512 }, (_, i) => 0.002 * Math.sin(i / 3)))).toBeLessThan(-42);
  });
});
