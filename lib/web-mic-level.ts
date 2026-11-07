import { rmsDb } from "@/lib/jp/voice-turn";

export type MicLevel = { read: () => number; stop: () => void };

/**
 * Microphone loudness in a browser (iPhone Safari, Chrome), for hands-free live talk: the
 * phone app reads the recorder's meter, which browsers do not give, so this listens alongside.
 * Returns null when the browser has no microphone access.
 */
export async function startWebMicLevel(): Promise<MicLevel | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    stream.getTracks().forEach((track) => track.stop());
    return null;
  }
  const context = new AudioCtx();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  return {
    read() {
      analyser.getFloatTimeDomainData(samples);
      return rmsDb(samples);
    },
    stop() {
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}
