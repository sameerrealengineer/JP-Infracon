import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ChipGroup, InlineError, SecondaryButton } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { readBase64 } from "@/lib/device-files";
import type { IssueDraftFields } from "@/lib/jp/ai-extraction";
import { trpc } from "@/lib/trpc";

const languages = { "od-IN": "ଓଡ଼ିଆ", "hi-IN": "हिन्दी", "en-IN": "English" } as const;
type Lang = keyof typeof languages;
const MAX_SECONDS = 28;

/**
 * Speak (Odia, Hindi or English) or type freely; the server transcribes with Sarvam AI and
 * fills the issue form. The person still reviews every field before sending.
 */
export function VoiceIssueAssist({
  siteId,
  onFields,
}: {
  siteId: string;
  onFields: (fields: IssueDraftFields) => void;
}) {
  const colors = useColors();
  const status = trpc.jp.ai.status.useQuery();
  const transcribe = trpc.jp.ai.transcribe.useMutation();
  const fill = trpc.jp.ai.fillIssue.useMutation();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [language, setLanguage] = useState<Lang>("od-IN");
  const [recording, setRecording] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (status.data && !status.data.formFill) return null;
  const busy = transcribe.isPending || fill.isPending;

  const stop = async () => {
    if (timer.current) clearTimeout(timer.current);
    setRecording(false);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("No recording was captured.");
      const audioBase64 = await readBase64(uri);
      const result = await transcribe.mutateAsync({
        siteId,
        audioBase64,
        mimeType: "audio/mp4",
        language,
      });
      setText((current) => (current ? `${current} ${result.transcript}` : result.transcript));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The voice note could not be read.");
    }
  };

  const start = async () => {
    setError(null);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error("Microphone permission was not given.");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      timer.current = setTimeout(() => void stop(), MAX_SECONDS * 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recording could not start.");
    }
  };

  const fillForm = async () => {
    setError(null);
    try {
      onFields(await fill.mutateAsync({ siteId, text: text.trim() }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The form could not be filled.");
    }
  };

  return (
    <View
      style={[
        styles.box,
        { borderColor: `${colors.accent}55`, backgroundColor: `${colors.accent}0D` },
      ]}
    >
      <View style={styles.header}>
        <MaterialIcons name="auto-awesome" size={18} color={colors.accent} />
        <Text style={[styles.title, { color: colors.foreground }]}>
          Speak or type — AI fills the form
        </Text>
      </View>
      {status.data?.voice ? (
        <>
          <ChipGroup
            options={Object.keys(languages) as Lang[]}
            value={language}
            onChange={setLanguage}
            format={(value) => languages[value]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recording ? "Stop recording" : "Start recording"}
            onPress={() => void (recording ? stop() : start())}
            disabled={busy}
            style={[styles.mic, { backgroundColor: recording ? colors.error : colors.primary }]}
          >
            {transcribe.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <MaterialIcons name={recording ? "stop" : "mic"} size={30} color="#fff" />
            )}
          </Pressable>
          <Text style={[styles.hint, { color: colors.muted }]}>
            {recording
              ? `Listening… tap to stop (max ${MAX_SECONDS} s)`
              : "Tap the mic and describe the problem"}
          </Text>
        </>
      ) : null}
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        placeholder="…or type in your own words, any language"
        placeholderTextColor={colors.muted}
        accessibilityLabel="Describe the issue in your own words"
        style={[
          styles.input,
          { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface },
        ]}
      />
      {error ? <InlineError message={error} title="AI assist" /> : null}
      <SecondaryButton
        icon="auto-fix-high"
        label={fill.isPending ? "Filling…" : "Fill the form with AI"}
        disabled={text.trim().length < 3 || busy}
        onPress={() => void fillForm()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 10, marginBottom: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 14, fontWeight: "800" },
  mic: {
    alignSelf: "center",
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  hint: { fontSize: 12, textAlign: "center" },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 70,
    padding: 12,
    fontSize: 14,
    textAlignVertical: "top",
  },
});
