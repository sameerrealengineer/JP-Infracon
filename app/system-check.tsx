import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  InlineError,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
  formatDateTime,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { readBase64 } from "@/lib/device-files";
import { getApiBaseUrl } from "@/constants/api";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

type Row = { key: string; title: string; ok: boolean; detail: string; ms: number };

/**
 * For owners and admins: checks every service voice, bill scan, documents and alerts depend on,
 * from this phone, and says exactly what fails.
 */
export default function SystemCheckScreen() {
  const { t } = useT();
  const colors = useColors();
  const run = trpc.jp.systemCheck.run.useMutation();
  const voice = trpc.jp.systemCheck.voice.useMutation();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [result, setResult] = useState<{ checks: Row[]; at: string } | null>(null);
  const [voiceResult, setVoiceResult] = useState<Row | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    try {
      setResult(await run.mutateAsync());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The check could not run.");
    }
  };

  const testMic = async () => {
    setError(null);
    setVoiceResult(null);
    const started = Date.now();
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted)
        throw new Error("Microphone permission is off. Allow it in the phone's app settings.");
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      await new Promise((resolve) => setTimeout(resolve, 4000));
      await recorder.stop();
      setRecording(false);
      if (!recorder.uri) throw new Error("The phone did not save a recording.");
      const heard = await voice.mutateAsync({
        audioBase64: await readBase64(recorder.uri),
        mimeType: "audio/mp4",
      });
      setVoiceResult({
        key: "mic",
        title: "This phone's microphone → text",
        ok: true,
        detail: heard.transcript
          ? `Heard "${heard.transcript}" (${heard.language})`
          : "Recording reached the server but no words were heard. Speak louder and try again.",
        ms: Date.now() - started,
      });
    } catch (cause) {
      setRecording(false);
      setVoiceResult({
        key: "mic",
        title: "This phone's microphone → text",
        ok: false,
        detail: cause instanceof Error ? cause.message : "Failed",
        ms: Date.now() - started,
      });
    }
  };

  const rows = [...(result?.checks ?? []), ...(voiceResult ? [voiceResult] : [])];
  const failed = rows.filter((row) => !row.ok).length;

  return (
    <AuthGate>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppHeader
            eyebrow={t("Settings")}
            title={t("System check")}
            subtitle={t(
              "Tests AI assistant, bill scan, voice, file uploads, document search and WhatsApp for real, and shows what fails and why.",
            )}
          />
          <Card>
            <Text style={[styles.meta, { color: colors.muted }]}>
              {t("Server")}: {getApiBaseUrl() || t("this website")}
            </Text>
            <PrimaryButton
              icon="health-and-safety"
              label={t("Run system check")}
              loading={run.isPending}
              onPress={() => void start()}
            />
            {Platform.OS !== "web" ? (
              <SecondaryButton
                icon="mic"
                label={recording ? t("Speak now… (4 seconds)") : t("Test this phone's microphone")}
                disabled={recording || voice.isPending}
                onPress={() => void testMic()}
              />
            ) : null}
          </Card>
          {error ? <InlineError message={error} /> : null}
          {rows.length ? (
            <>
              <SectionHeader
                title={failed ? t("{count} problems found", { count: failed }) : t("All working")}
                caption={result ? formatDateTime(result.at) : undefined}
              />
              {rows.map((row) => (
                <Card key={row.key} accent={row.ok ? "success" : "error"}>
                  <View style={styles.row}>
                    <MaterialIcons
                      name={row.ok ? "check-circle" : "error"}
                      size={22}
                      color={row.ok ? colors.success : colors.error}
                    />
                    <Text style={[styles.title, { color: colors.foreground }]}>{t(row.title)}</Text>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {(row.ms / 1000).toFixed(1)} s
                    </Text>
                  </View>
                  <Text
                    selectable
                    style={[styles.detail, { color: row.ok ? colors.muted : colors.error }]}
                  >
                    {row.detail}
                  </Text>
                </Card>
              ))}
            </>
          ) : null}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: "800" },
  meta: { fontSize: 12 },
  detail: { fontSize: 13, marginTop: 6, lineHeight: 18 },
});
