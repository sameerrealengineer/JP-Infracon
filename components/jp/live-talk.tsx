import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import {
  RecordingPresets,
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioPlayer,
} from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { audioFileFromBase64, readBase64 } from "@/lib/device-files";
import type { AssistantAction } from "@/lib/jp/assistant-catalog";
import {
  nextVoiceTurn,
  startVoiceTurn,
  type SpokenLanguage,
  type VoiceTurnState,
} from "@/lib/jp/voice-turn";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

type Phase = "listening" | "hearing" | "thinking" | "speaking" | "paused";
type Turn = { role: "user" | "assistant"; text: string };

/** Wall-clock milliseconds; only called from event handlers and timers. */
const clock = () => Date.now();

const RECORDING = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };

/**
 * Hands-free conversation with the assistant: it listens, notices when you stop talking,
 * answers from your data in your language, speaks, and listens again. Tap the circle to
 * interrupt or to speak again. Nothing is saved; drafts still open as forms you check.
 */
export function LiveTalk({
  visible,
  onClose,
  siteId,
  language,
  history,
  onTurn,
}: {
  visible: boolean;
  onClose: () => void;
  siteId: string | null;
  language: SpokenLanguage;
  history: Turn[];
  onTurn: (question: string, reply: string, action: AssistantAction) => void;
}) {
  const { t } = useT();
  const recorder = useAudioRecorder(RECORDING);
  const talk = trpc.jp.assistant.talk.useMutation();
  const speak = trpc.jp.assistant.speak.useMutation();
  const [phase, setPhase] = useState<Phase>("paused");
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const turn = useRef<VoiceTurnState | null>(null);
  const player = useRef<AudioPlayer | null>(null);
  const active = useRef(false);
  const conversation = useRef<Turn[]>([]);
  /** Bumped when listening starts again, so a reply still on its way never plays over it. */
  const epoch = useRef(0);

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const stopAll = async () => {
    active.current = false;
    stopTimer();
    player.current?.remove();
    player.current = null;
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch {
      // Already stopped.
    }
  };

  // Release the microphone and speaker when the screen goes away.
  useEffect(
    () => () => {
      void stopAll();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const listen = async () => {
    if (!active.current) return;
    epoch.current += 1;
    setError(null);
    try {
      player.current?.remove();
      player.current = null;
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      turn.current = startVoiceTurn(clock());
      setPhase("listening");
      stopTimer();
      timer.current = setInterval(() => {
        if (!turn.current) return;
        const level = recorder.getStatus().metering;
        const result = nextVoiceTurn(turn.current, level, clock());
        turn.current = result.state;
        if (result.decision === "speaking") setPhase("hearing");
        if (result.decision === "done") void finishTurn();
        if (result.decision === "idle") void pause();
      }, 150);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The microphone could not start.");
      setPhase("paused");
    }
  };

  const pause = async () => {
    stopTimer();
    turn.current = null;
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch {
      // Already stopped.
    }
    setPhase("paused");
  };

  const finishTurn = async () => {
    stopTimer();
    turn.current = null;
    setPhase("thinking");
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("No recording was captured.");
      // One round trip: words, answer and the first sentence's audio come back together.
      const result = await talk.mutateAsync({
        audioBase64: await readBase64(uri),
        mimeType: "audio/mp4",
        language,
        history: [...history, ...conversation.current].slice(-8),
        siteId,
      });
      if (!active.current) return;
      if (!result.heard) {
        void listen();
        return;
      }
      setHeard(result.heard);
      conversation.current = [
        ...conversation.current,
        { role: "user" as const, text: result.heard },
        { role: "assistant" as const, text: result.reply },
      ].slice(-8);
      setSaid(result.reply);
      if (result.action) onTurn(result.heard, result.reply, result.action);
      // An action (open a screen, start a draft) needs the person's eyes: stop after speaking.
      const thenListen = !result.action || result.action.type === "none";
      // Make the rest of the answer while the first sentence plays.
      const rest = result.rest
        ? speak.mutateAsync({ text: result.rest.slice(0, 1200), language: result.language })
        : null;
      rest?.catch(() => null);
      await playQueue(
        [result.audio ? Promise.resolve(result.audio) : null, rest],
        thenListen,
        epoch.current,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work. Tap to try again.");
      setPhase("paused");
    }
  };

  type Clip = { audioBase64: string; mimeType: string };

  /** Plays the clips in order (each may still be on its way), then listens or pauses. */
  const playQueue = async (
    clips: (Promise<Clip> | null)[],
    thenListen: boolean,
    turnId: number,
  ): Promise<void> => {
    const [head, ...tail] = clips;
    if (head === undefined) {
      if (thenListen) void listen();
      else setPhase("paused");
      return;
    }
    const audio = head ? await head.catch(() => null) : null;
    // Closed, or the person tapped to talk again while this was on its way.
    if (!active.current || epoch.current !== turnId) return;
    if (!audio) return playQueue(tail, thenListen, turnId);
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      const next = createAudioPlayer({
        uri: audioFileFromBase64(audio.audioBase64, audio.mimeType),
      });
      player.current = next;
      next.addListener("playbackStatusUpdate", (status) => {
        if (!status.didJustFinish || player.current !== next) return;
        next.remove();
        player.current = null;
        void playQueue(tail, thenListen, turnId);
      });
      setPhase("speaking");
      next.play();
    } catch {
      // The written answer is on screen; carry on.
      void playQueue(tail, thenListen, turnId);
    }
  };

  const begin = async () => {
    setError(null);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError("Microphone permission was not given.");
      return;
    }
    active.current = true;
    void listen();
  };

  /** The big circle: start, interrupt the reply, or finish speaking early. */
  const tap = () => {
    if (phase === "paused") void begin();
    else if (phase === "speaking") {
      player.current?.remove();
      player.current = null;
      void listen();
    } else if (phase === "hearing") void finishTurn();
  };

  const close = async () => {
    await stopAll();
    setPhase("paused");
    onClose();
  };

  const label: Record<Phase, string> = {
    paused: "Tap to talk",
    listening: "Listening…",
    hearing: "Hearing you… pause when done",
    thinking: "Thinking…",
    speaking: "Speaking — tap to interrupt",
  };
  const ring = phase === "hearing" ? "#4CC38A" : phase === "speaking" ? "#D9B76A" : "#5B8DEF";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => void close()}>
      <View style={styles.screen}>
        <View style={styles.top}>
          <Text style={styles.kicker}>{t("LIVE TALK")}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("End live talk")}
            onPress={() => void close()}
            hitSlop={12}
          >
            <MaterialIcons name="close" size={28} color="#FFFFFF" />
          </Pressable>
        </View>
        <Text style={styles.hint}>
          {t("Speak in Odia, Hindi or English. I answer from your sites and records.")}
        </Text>
        <View style={styles.center}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(label[phase])}
            onPress={tap}
            disabled={phase === "thinking" || phase === "listening"}
            style={({ pressed }) => [
              styles.orb,
              { borderColor: ring, shadowColor: ring },
              pressed && { transform: [{ scale: 0.96 }] },
            ]}
          >
            <MaterialIcons
              name={
                phase === "speaking"
                  ? "graphic-eq"
                  : phase === "thinking"
                    ? "more-horiz"
                    : phase === "paused"
                      ? "mic-none"
                      : "mic"
              }
              size={64}
              color="#FFFFFF"
            />
          </Pressable>
          <Text style={styles.phase}>{t(label[phase])}</Text>
        </View>
        <View style={styles.transcript}>
          {heard ? (
            <Text style={styles.you} numberOfLines={3}>
              {t("You")}: {heard}
            </Text>
          ) : null}
          {said ? (
            <Text style={styles.reply} numberOfLines={6}>
              {said}
            </Text>
          ) : null}
          {error ? <Text style={styles.error}>{t(error)}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0A1624", padding: 24, paddingTop: 48 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  kicker: { color: "#D9B76A", fontSize: 12, fontWeight: "800", letterSpacing: 2 },
  hint: { color: "rgba(255,255,255,0.7)", fontSize: 14, marginTop: 10, lineHeight: 20 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 22 },
  orb: {
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#132B44",
    shadowOpacity: 0.6,
    shadowRadius: 30,
    elevation: 12,
  },
  phase: { color: "#FFFFFF", fontSize: 17, fontWeight: "700", textAlign: "center" },
  transcript: { gap: 10, minHeight: 140 },
  you: { color: "rgba(255,255,255,0.65)", fontSize: 14, lineHeight: 20 },
  reply: { color: "#FFFFFF", fontSize: 17, lineHeight: 25, fontWeight: "600" },
  error: { color: "#FF9B8A", fontSize: 14 },
});
