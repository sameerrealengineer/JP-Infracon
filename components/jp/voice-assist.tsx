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
import { compressPhoto, readBase64 } from "@/lib/device-files";
import type { IssueDraftFields } from "@/lib/jp/ai-extraction";
import type { ReportDraftFields } from "@/lib/jp/ai-report-extraction";
import type { RequestDraftFields } from "@/lib/jp/ai-request-extraction";
import type { ExpenseDraftFields } from "@/lib/jp/ai-expense-extraction";
import * as ImagePicker from "expo-image-picker";
import { trpc } from "@/lib/trpc";
import { FORM_SPECS, type FormId } from "@/lib/jp/form-fill";
import { useT } from "@/lib/i18n";

const languages = { "od-IN": "ଓଡ଼ିଆ", "hi-IN": "हिन्दी", "en-IN": "English" } as const;
type Lang = keyof typeof languages;
const MAX_SECONDS = 28;

/** Voice or typed text → issue form fields. */
export function VoiceIssueAssist({
  siteId,
  onFields,
  initialText,
}: {
  siteId: string;
  onFields: (fields: IssueDraftFields) => void;
  initialText?: string;
}) {
  const fill = trpc.jp.ai.fillIssue.useMutation();
  return (
    <VoiceAssist
      siteId={siteId}
      prompt="Tap the mic and describe the problem"
      textLabel="Describe the issue in your own words"
      initialText={initialText}
      filling={fill.isPending}
      onFill={async (text) => onFields(await fill.mutateAsync({ siteId, text }))}
    />
  );
}

/** Voice or typed day summary → daily report draft fields (work lines for a DPR). */
export function VoiceReportAssist({
  siteId,
  reportKind,
  onFields,
  initialText,
}: {
  siteId: string;
  reportKind: "DPR" | "DLR";
  onFields: (fields: ReportDraftFields) => void;
  initialText?: string;
}) {
  const fill = trpc.jp.ai.fillReport.useMutation();
  return (
    <VoiceAssist
      siteId={siteId}
      prompt={
        reportKind === "DPR"
          ? "Tap the mic and say what work was done today, where, and how much"
          : "Tap the mic and say who worked today, by trade"
      }
      textLabel="Describe today's work in your own words"
      initialText={initialText}
      filling={fill.isPending}
      onFill={async (text) => onFields(await fill.mutateAsync({ siteId, reportKind, text }))}
    />
  );
}

/** Voice, typed note or receipt photo → petty cash expense fields. */
export function ExpenseAssist({
  siteId,
  onFields,
}: {
  siteId: string;
  onFields: (fields: ExpenseDraftFields) => void;
}) {
  const { t } = useT();
  const fill = trpc.jp.ai.fillExpense.useMutation();
  const [scanError, setScanError] = useState<string | null>(null);
  const scan = async () => {
    setScanError(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      const result = permission.granted
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
      if (result.canceled || !result.assets[0]) return;
      const imageBase64 = await compressPhoto(result.assets[0].uri, 1400);
      onFields(await fill.mutateAsync({ siteId, imageBase64 }));
    } catch (cause) {
      setScanError(cause instanceof Error ? cause.message : "The receipt could not be read.");
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <SecondaryButton
        icon="receipt-long"
        label={fill.isPending ? "Reading receipt…" : t("Scan receipt with AI")}
        disabled={fill.isPending}
        onPress={() => void scan()}
      />
      {scanError ? <InlineError message={scanError} /> : null}
      <VoiceAssist
        siteId={siteId}
        prompt="Or tap the mic and say what was paid, to whom and for what"
        textLabel="e.g. 450 rupees diesel generator ke liye, Mahavir petrol pump, cash"
        filling={fill.isPending}
        onFill={async (text) => onFields(await fill.mutateAsync({ siteId, text }))}
      />
    </View>
  );
}

/** Voice or typed material need → material request fields. */
export function VoiceRequestAssist({
  siteId,
  onFields,
}: {
  siteId: string;
  onFields: (fields: RequestDraftFields) => void;
}) {
  const fill = trpc.jp.ai.fillRequest.useMutation();
  return (
    <VoiceAssist
      siteId={siteId}
      prompt="Tap the mic and say what material you need, how much, and for what"
      textLabel="e.g. 50 bori cement aur 2 ton 12mm saria, first floor slab ke liye"
      filling={fill.isPending}
      onFill={async (text) => onFields(await fill.mutateAsync({ siteId, text }))}
    />
  );
}

/** Example words shown in the type box for each form. */
const FORM_EXAMPLES: Record<FormId, string> = {
  worker: "e.g. Ramesh Behera, mistri, mobile 98765 43210",
  client: "e.g. PWD Aska division, government, contact Mr. Das 94370 12345",
  lead: "e.g. Sahu ji ka G+2 ghar Aska mein, 25 lakh, referral se, Monday follow-up",
  supplier: "e.g. Maa Tarini Traders, cement supplier, Bhubaneswar, 30 din credit",
  task: "e.g. first floor slab shuttering, kal se 5 din, high priority",
  advance: "e.g. 2000 rupaye cash diye ghar ke kaam ke liye, 500 har pay run katna",
  materialItem: "e.g. OPC 53 grade cement, bag mein, 50 bag se kam ho to batana",
};

/**
 * "Speak or type — AI fills the form" for any form in `lib/jp/form-fill.ts`. It remembers what
 * was said, so answering its follow-up question adds to the earlier details. Only fills fields;
 * the person checks them and saves.
 */
export function AiFormFill({
  formId,
  siteId,
  onValues,
}: {
  formId: FormId;
  siteId?: string | null;
  onValues: (values: Partial<Record<string, string>>) => void;
}) {
  const { t } = useT();
  const colors = useColors();
  const fill = trpc.jp.ai.fillForm.useMutation();
  const said = useRef("");
  const [result, setResult] = useState<{
    filled: number;
    missing: string[];
    question: string | null;
  } | null>(null);
  const spec = FORM_SPECS[formId];
  const run = async (text: string) => {
    const combined = said.current ? `${said.current}\n${text}` : text;
    const answer = await fill.mutateAsync({ formId, siteId: siteId ?? undefined, text: combined });
    said.current = combined;
    onValues(answer.values);
    setResult({
      filled: Object.keys(answer.values).length,
      missing: answer.missing,
      question: answer.question,
    });
  };
  if (spec.scope === "site" && !siteId) return null;
  return (
    <VoiceAssist
      siteId={siteId ?? undefined}
      prompt="Tap the mic and say the details"
      textLabel={FORM_EXAMPLES[formId]}
      filling={fill.isPending}
      autoFill
      onFill={run}
    >
      {result ? (
        <View
          style={[styles.result, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.resultText, { color: colors.foreground }]}>
            {result.missing.length
              ? `✍️ ${t("Filled {count} fields. Still needed: {fields}", {
                  count: result.filled,
                  fields: result.missing.map((label) => t(label)).join(", "),
                })}`
              : `✅ ${t("Filled {count} fields. Check them below, then save.", { count: result.filled })}`}
          </Text>
          {result.question ? (
            <Text style={[styles.question, { color: colors.primary }]}>🤖 {result.question}</Text>
          ) : null}
          {result.missing.length ? (
            <Text style={[styles.hint, { color: colors.muted, textAlign: "left" }]}>
              {t("Answer by mic or type below; it adds to what you said before.")}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              said.current = "";
              setResult(null);
            }}
            hitSlop={8}
          >
            <Text style={[styles.hint, { color: colors.primary, textAlign: "left" }]}>
              {t("Start again")}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </VoiceAssist>
  );
}

/**
 * Speak (Odia, Hindi or English) or type freely; the server transcribes with Sarvam AI and
 * an AI model fills the form. The person still reviews every field before saving.
 */
function VoiceAssist({
  siteId,
  prompt,
  textLabel,
  filling,
  onFill,
  initialText = "",
  autoFill = false,
  children,
}: {
  /** Absent for company-wide forms (clients, enquiries). */
  siteId?: string;
  prompt: string;
  textLabel: string;
  /** Fill as soon as a voice note is read, and clear the box after each fill (for follow-ups). */
  autoFill?: boolean;
  /** Shown under the title, e.g. what the AI filled and what it still needs. */
  children?: React.ReactNode;
  /** Words passed on from the assistant, ready to fill the form with one tap. */
  initialText?: string;
  filling: boolean;
  onFill: (text: string) => Promise<void>;
}) {
  const colors = useColors();
  const status = trpc.jp.ai.status.useQuery();
  const transcribe = trpc.jp.ai.transcribe.useMutation();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [language, setLanguage] = useState<Lang>("od-IN");
  const [recording, setRecording] = useState(false);
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (status.data && !status.data.formFill) return null;
  const busy = transcribe.isPending || filling;

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
      if (autoFill && result.transcript.trim().length >= 2) {
        await onFill(result.transcript.trim());
        setText("");
      } else
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
      await onFill(text.trim());
      if (autoFill) setText("");
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
      {children}
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
            {recording ? `Listening… tap to stop (max ${MAX_SECONDS} s)` : prompt}
          </Text>
        </>
      ) : null}
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        placeholder="…or type in your own words, any language"
        placeholderTextColor={colors.muted}
        accessibilityLabel={textLabel}
        style={[
          styles.input,
          { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface },
        ]}
      />
      {error ? <InlineError message={error} title="AI assist" /> : null}
      <SecondaryButton
        icon="auto-fix-high"
        label={filling ? "Filling…" : "Fill the form with AI"}
        disabled={text.trim().length < 2 || busy}
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
  result: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 },
  resultText: { fontSize: 14, fontWeight: "700" },
  question: { fontSize: 15, fontWeight: "800" },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 70,
    padding: 12,
    fontSize: 14,
    textAlignVertical: "top",
  },
});
