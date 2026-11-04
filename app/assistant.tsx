import { useT } from "@/lib/i18n";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import {
  RecordingPresets,
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioPlayer,
} from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { AuthGate } from "@/components/jp/auth-gate";
import { LiveTalk } from "@/components/jp/live-talk";
import { AppHeader, ChipGroup, EmptyState, InlineError, Screen } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { audioFileFromBase64, compressPhoto, readBase64 } from "@/lib/device-files";
import {
  ASSISTANT_PICKER_TYPES,
  MAX_ASSISTANT_FILES,
  MAX_ASSISTANT_FILE_BYTES,
  base64Bytes,
} from "@/lib/jp/assistant-files";
import { formatBytes } from "@/lib/jp/attachment-policy";
import type { AssistantAction } from "@/lib/jp/assistant-catalog";
import { trpc } from "@/lib/trpc";

const LANGUAGES = { "od-IN": "ଓଡ଼ିଆ", "hi-IN": "हिन्दी", "en-IN": "English" } as const;
type Lang = keyof typeof LANGUAGES;
const MAX_SECONDS = 28;

type Attached = { id: string; name: string; base64: string; photo: boolean };
type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  action?: AssistantAction;
  files?: string[];
};

const EXAMPLES = [
  "Aaj ka kaam kya baaki hai?",
  "Which site is behind schedule?",
  "First floor pe 120 sqft plaster hua, report bana do",
  "Scaffolding loose hai Block A me",
];

/**
 * Talk or type to the assistant. It answers from your own data and can open a screen or start
 * a draft; you always check and save the draft yourself.
 */
export default function AssistantScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const status = trpc.jp.assistant.status.useQuery();
  const sites = trpc.jp.workspace.mySites.useQuery();
  const ask = trpc.jp.assistant.ask.useMutation();
  const speak = trpc.jp.assistant.speak.useMutation();
  const transcribe = trpc.jp.ai.transcribe.useMutation();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [language, setLanguage] = useState<Lang>("hi-IN");
  const [liveOpen, setLiveOpen] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [attached, setAttached] = useState<Attached[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const player = useRef<AudioPlayer | null>(null);
  const scroll = useRef<ScrollView>(null);
  const nextId = useRef(0);
  const newId = (prefix: string) => {
    nextId.current += 1;
    return `${prefix}-${nextId.current}`;
  };
  const siteId = sites.data?.[0]?.id ?? null;
  const busy = ask.isPending || transcribe.isPending;

  const play = async (text: string) => {
    try {
      const audio = await speak.mutateAsync({ text: text.slice(0, 1200), language });
      player.current?.remove();
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      player.current = createAudioPlayer({
        uri: audioFileFromBase64(audio.audioBase64, audio.mimeType),
      });
      player.current.play();
    } catch {
      // The written reply is already on screen.
    }
  };

  const addFile = (file: Omit<Attached, "id">) => {
    if (base64Bytes(file.base64) > MAX_ASSISTANT_FILE_BYTES)
      throw new Error(`${file.name} is larger than 10 MB.`);
    setAttached((prev) => [...prev, { ...file, id: newId("f") }].slice(0, MAX_ASSISTANT_FILES));
  };

  const attach = async (source: "camera" | "gallery" | "file") => {
    setError(null);
    setAttachOpen(false);
    try {
      if (attached.length >= MAX_ASSISTANT_FILES)
        throw new Error(`Attach at most ${MAX_ASSISTANT_FILES} files at a time.`);
      if (source === "file") {
        const result = await DocumentPicker.getDocumentAsync({
          type: ASSISTANT_PICKER_TYPES,
          copyToCacheDirectory: true,
          multiple: true,
        });
        if (result.canceled) return;
        for (const asset of result.assets.slice(0, MAX_ASSISTANT_FILES - attached.length)) {
          if (asset.size && asset.size > MAX_ASSISTANT_FILE_BYTES)
            throw new Error(`${asset.name} is larger than 10 MB.`);
          const photo = (asset.mimeType ?? "").startsWith("image/");
          addFile({
            name: asset.name,
            base64:
              photo && Platform.OS !== "web"
                ? await compressPhoto(asset.uri)
                : await readBase64(asset.uri),
            photo,
          });
        }
        return;
      }
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error("Camera permission was not given.");
      }
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      addFile({
        name: asset.fileName ?? `photo-${new Date().toISOString().slice(0, 10)}.jpg`,
        base64:
          Platform.OS === "web" ? await readBase64(asset.uri) : await compressPhoto(asset.uri),
        photo: true,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file could not be read.");
    }
  };

  const send = async (raw: string) => {
    const text = raw.trim() || (attached.length ? t("Explain these files") : "");
    if (!text || busy) return;
    setError(null);
    setInput("");
    const files = attached;
    setAttached([]);
    const history = messages.slice(-8).map(({ role, text: t }) => ({ role, text: t }));
    const mine: Message = {
      id: newId("u"),
      role: "user",
      text,
      files: files.map((file) => file.name),
    };
    setMessages((prev) => [...prev, mine]);
    try {
      const answer = await ask.mutateAsync({
        text,
        history,
        siteId,
        files: files.map(({ name, base64 }) => ({ name, base64 })),
      });
      setMessages((prev) => [
        ...prev,
        { id: newId("a"), role: "assistant", text: answer.reply, action: answer.action },
      ]);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
      if (speakReplies && status.data?.speech) void play(answer.reply);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The assistant did not answer.");
    }
  };

  const stop = async () => {
    if (timer.current) clearTimeout(timer.current);
    setRecording(false);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri || !siteId) throw new Error("No recording was captured.");
      const result = await transcribe.mutateAsync({
        siteId,
        audioBase64: await readBase64(uri),
        mimeType: "audio/mp4",
        language,
      });
      if (result.transcript) await send(result.transcript);
      else setError("Nothing was heard. Try again a little closer to the phone.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The voice note could not be read.");
    }
  };

  const start = async () => {
    setError(null);
    try {
      player.current?.pause();
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error("Microphone permission was not given.");
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      timer.current = setTimeout(() => void stop(), MAX_SECONDS * 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recording could not start.");
    }
  };

  const unavailable = status.data && !status.data.available;

  return (
    <AuthGate>
      <Screen>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            ref={scroll}
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <AppHeader
              eyebrow="AI assistant"
              title={t("Ask JP")}
              subtitle={t(
                "Speak or type in Odia, Hindi or English. I can find things, explain, open the right screen or start a draft. You check and save.",
              )}
            />
            {unavailable ? (
              <EmptyState
                icon="smart-toy"
                title="Assistant is not set up"
                detail="The server needs a GEMINI_API_KEY or SARVAM_API_KEY."
              />
            ) : null}
            <ChipGroup
              label="Language"
              options={Object.keys(LANGUAGES) as Lang[]}
              value={language}
              onChange={setLanguage}
              format={(key) => LANGUAGES[key]}
            />
            {status.data?.voice && status.data.speech && Platform.OS !== "web" && siteId ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Live talk")}
                onPress={() => setLiveOpen(true)}
                style={({ pressed }) => [
                  styles.live,
                  { backgroundColor: colors.primary },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <MaterialIcons name="record-voice-over" size={22} color={colors.background} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.liveTitle, { color: colors.background }]}>
                    {t("Live talk")}
                  </Text>
                  <Text style={[styles.liveDetail, { color: colors.background }]}>
                    {t("Hands-free conversation in Odia, Hindi or English")}
                  </Text>
                </View>
              </Pressable>
            ) : null}
            {status.data?.speech ? (
              <View style={styles.toggle}>
                <MaterialIcons name="volume-up" size={18} color={colors.muted} />
                <Text style={[styles.toggleText, { color: colors.foreground }]}>
                  {t("Speak replies aloud")}
                </Text>
                <Switch value={speakReplies} onValueChange={setSpeakReplies} />
              </View>
            ) : null}

            {messages.length === 0 && !unavailable ? (
              <View style={styles.examples}>
                <Text style={[styles.hint, { color: colors.muted }]}>{t("Try saying:")}</Text>
                {EXAMPLES.map((example) => (
                  <Pressable
                    key={example}
                    accessibilityRole="button"
                    onPress={() => void send(example)}
                    style={({ pressed }) => [
                      styles.example,
                      { borderColor: colors.border, backgroundColor: colors.surface },
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <MaterialIcons name="chat-bubble-outline" size={16} color={colors.accent} />
                    <Text style={[styles.exampleText, { color: colors.foreground }]}>
                      {example}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {messages.map((message) => (
              <View
                key={message.id}
                style={[
                  styles.bubble,
                  message.role === "user"
                    ? [styles.mine, { backgroundColor: colors.primary }]
                    : [
                        styles.theirs,
                        { backgroundColor: colors.surface, borderColor: colors.border },
                      ],
                ]}
              >
                <Text
                  selectable
                  style={[
                    styles.bubbleText,
                    { color: message.role === "user" ? colors.background : colors.foreground },
                  ]}
                >
                  {message.text}
                </Text>
                {message.files?.length ? (
                  <View style={styles.fileList}>
                    {message.files.map((name) => (
                      <View key={name} style={styles.fileTag}>
                        <MaterialIcons name="attach-file" size={14} color={colors.background} />
                        <Text
                          style={[styles.fileTagText, { color: colors.background }]}
                          numberOfLines={1}
                        >
                          {name}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {message.action && message.action.type !== "none" ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push((message.action as { route: string }).route as never)
                    }
                    style={({ pressed }) => [
                      styles.actionButton,
                      { backgroundColor: colors.accent },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <MaterialIcons
                      name={message.action.type === "open" ? "open-in-new" : "edit-note"}
                      size={18}
                      color="#0E1A26"
                    />
                    <Text style={styles.actionText}>
                      {"label" in message.action ? message.action.label : "Open"}
                    </Text>
                  </Pressable>
                ) : null}
                {message.action?.type === "draft_report" ||
                message.action?.type === "draft_issue" ? (
                  <Text style={[styles.hint, { color: colors.muted }]}>
                    {t("Nothing is saved yet. The form opens with your words; check it and save.")}
                  </Text>
                ) : null}
                {message.role === "assistant" && status.data?.speech ? (
                  <Text
                    accessibilityRole="button"
                    onPress={() => void play(message.text)}
                    style={[styles.replay, { color: colors.primary }]}
                  >
                    ▶ Listen
                  </Text>
                ) : null}
              </View>
            ))}
            {busy ? (
              <View style={[styles.bubble, styles.theirs, { borderColor: colors.border }]}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null}
            {error ? <InlineError message={error} /> : null}
          </ScrollView>

          {!unavailable && (attached.length > 0 || attachOpen) ? (
            <View style={styles.tray}>
              {attached.map((file) => (
                <View
                  key={file.id}
                  style={[
                    styles.chip,
                    { borderColor: colors.border, backgroundColor: colors.surface },
                  ]}
                >
                  <MaterialIcons
                    name={file.photo ? "image" : "description"}
                    size={16}
                    color={colors.primary}
                  />
                  <Text style={[styles.chipText, { color: colors.foreground }]} numberOfLines={1}>
                    {file.name} · {formatBytes(base64Bytes(file.base64))}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${file.name}`}
                    hitSlop={8}
                    onPress={() => setAttached((prev) => prev.filter((row) => row.id !== file.id))}
                  >
                    <MaterialIcons name="close" size={16} color={colors.muted} />
                  </Pressable>
                </View>
              ))}
              {attachOpen ? (
                <View style={styles.menu}>
                  {(
                    [
                      ...(Platform.OS !== "web"
                        ? ([["camera", "photo-camera", "Camera"]] as const)
                        : []),
                      ["gallery", "photo-library", "Gallery"],
                      ["file", "upload-file", "PDF, drawing, Word, Excel"],
                    ] as const
                  ).map(([source, icon, label]) => (
                    <Pressable
                      key={source}
                      accessibilityRole="button"
                      onPress={() => void attach(source)}
                      style={({ pressed }) => [
                        styles.menuItem,
                        { borderColor: colors.border, backgroundColor: colors.surface },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <MaterialIcons name={icon} size={20} color={colors.accent} />
                      <Text style={[styles.chipText, { color: colors.foreground }]}>
                        {t(label)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {!unavailable ? (
            <View
              style={[
                styles.composer,
                { borderColor: colors.border, backgroundColor: colors.background },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Attach a file")}
                disabled={busy || attached.length >= MAX_ASSISTANT_FILES}
                onPress={() => setAttachOpen((open) => !open)}
                style={[
                  styles.attach,
                  { borderColor: colors.border, backgroundColor: colors.surface },
                ]}
              >
                <MaterialIcons
                  name={attachOpen ? "close" : "attach-file"}
                  size={22}
                  color={colors.primary}
                />
              </Pressable>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={recording ? t("Listening…") : t("Type your question")}
                placeholderTextColor={colors.muted}
                accessibilityLabel="Message to assistant"
                multiline
                maxLength={2000}
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  },
                ]}
              />
              {input.trim() || attached.length ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send"
                  disabled={busy}
                  onPress={() => void send(input)}
                  style={[styles.round, { backgroundColor: colors.primary }]}
                >
                  <MaterialIcons name="send" size={22} color={colors.background} />
                </Pressable>
              ) : status.data?.voice && Platform.OS !== "web" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={recording ? "Stop and send" : "Speak"}
                  disabled={busy || !siteId}
                  onPress={() => void (recording ? stop() : start())}
                  style={[
                    styles.round,
                    { backgroundColor: recording ? colors.error : colors.accent },
                  ]}
                >
                  <MaterialIcons name={recording ? "stop" : "mic"} size={24} color="#0E1A26" />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </KeyboardAvoidingView>
        <LiveTalk
          visible={liveOpen}
          onClose={() => setLiveOpen(false)}
          siteId={siteId}
          language={language}
          history={messages.slice(-8).map(({ role, text }) => ({ role, text }))}
          onTurn={(question, reply, action) =>
            setMessages((prev) => [
              ...prev,
              { id: newId("u"), role: "user", text: question },
              { id: newId("a"), role: "assistant", text: reply, action },
            ])
          }
        />
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: 24, gap: 10 },
  live: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    padding: 14,
  },
  liveTitle: { fontSize: 15, fontWeight: "800" },
  liveDetail: { fontSize: 12, opacity: 0.85, marginTop: 2 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 8 },
  toggleText: { flex: 1, fontSize: 13, fontWeight: "700" },
  examples: { gap: 8, marginTop: 6 },
  example: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  exampleText: { fontSize: 14, flex: 1 },
  hint: { fontSize: 12, lineHeight: 17 },
  bubble: { maxWidth: "88%", borderRadius: 18, padding: 12, gap: 8 },
  mine: { alignSelf: "flex-end", borderBottomRightRadius: 4 },
  theirs: { alignSelf: "flex-start", borderWidth: 1, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignSelf: "flex-start",
  },
  actionText: { color: "#0E1A26", fontSize: 13, fontWeight: "800" },
  replay: { fontSize: 12, fontWeight: "800" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  attach: {
    width: 44,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tray: { gap: 8, paddingTop: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chipText: { flex: 1, fontSize: 13, fontWeight: "600" },
  menu: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fileList: { gap: 4 },
  fileTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  fileTagText: { fontSize: 12, fontWeight: "600", flexShrink: 1 },
  round: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
});
