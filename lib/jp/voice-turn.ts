/**
 * Hands-free talk: decides from the microphone level when the person started speaking and
 * when they finished, so the app can send their words without a button press.
 * Levels are in dBFS (about -160 silent to 0 loud), sampled every ~150 ms.
 */

export type VoiceTurnConfig = {
  /** Louder than this counts as speech. */
  speechDb: number;
  /** Speech must last this long to count (ignores clicks and bumps). */
  minSpeechMs: number;
  /** Quiet this long after speech ends the turn. */
  endSilenceMs: number;
  /** Nothing said for this long: stop listening. */
  idleMs: number;
  /** Longest single turn. */
  maxTurnMs: number;
};

export const DEFAULT_VOICE_TURN: VoiceTurnConfig = {
  speechDb: -42,
  minSpeechMs: 250,
  endSilenceMs: 1300,
  idleMs: 9000,
  maxTurnMs: 28_000,
};

export type VoiceTurnState = {
  startedAt: number;
  speechMs: number;
  firstSpeechAt: number | null;
  lastSpeechAt: number | null;
  lastSampleAt: number | null;
};

export type VoiceTurnDecision = "listening" | "speaking" | "done" | "idle";

export function startVoiceTurn(now: number): VoiceTurnState {
  return {
    startedAt: now,
    speechMs: 0,
    firstSpeechAt: null,
    lastSpeechAt: null,
    lastSampleAt: null,
  };
}

/** Feeds one level sample; returns the new state and what to do now. */
export function nextVoiceTurn(
  state: VoiceTurnState,
  levelDb: number | null | undefined,
  now: number,
  config: VoiceTurnConfig = DEFAULT_VOICE_TURN,
): { state: VoiceTurnState; decision: VoiceTurnDecision } {
  const step = state.lastSampleAt === null ? 0 : Math.max(0, now - state.lastSampleAt);
  const loud = typeof levelDb === "number" && Number.isFinite(levelDb) && levelDb > config.speechDb;
  const next: VoiceTurnState = { ...state, lastSampleAt: now };
  if (loud) {
    next.speechMs += step;
    next.lastSpeechAt = now;
    if (next.firstSpeechAt === null) next.firstSpeechAt = now;
  }
  const heard = next.speechMs >= config.minSpeechMs;
  if (now - state.startedAt >= config.maxTurnMs)
    return { state: next, decision: heard ? "done" : "idle" };
  if (!heard)
    return {
      state: next,
      decision: now - state.startedAt >= config.idleMs ? "idle" : loud ? "speaking" : "listening",
    };
  if (!loud && next.lastSpeechAt !== null && now - next.lastSpeechAt >= config.endSilenceMs)
    return { state: next, decision: "done" };
  return { state: next, decision: "speaking" };
}

const SPOKEN = ["od-IN", "hi-IN", "en-IN"] as const;
export type SpokenLanguage = (typeof SPOKEN)[number];

/** The language to answer aloud in: what was detected if we can speak it, else the chosen one. */
export function replyLanguage(detected: string | null | undefined, chosen: SpokenLanguage) {
  if (detected === "or-IN") return "od-IN";
  return SPOKEN.includes(detected as SpokenLanguage) ? (detected as SpokenLanguage) : chosen;
}
