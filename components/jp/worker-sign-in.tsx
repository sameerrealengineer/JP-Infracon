import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { DEMO_MODE, DEMO_WORKER } from "@/lib/demo/config";

type LoginResult = Awaited<
  ReturnType<ReturnType<typeof trpc.auth.workerLogin.useMutation>["mutateAsync"]>
>;

/**
 * Worker sign-in: mobile number, then the 6-digit PIN typed on the phone's own number keyboard
 * (one keyboard only). Signs in by itself when the sixth digit is typed. Saved-password
 * suggestions are switched off so staff logins never show up here.
 */
export function WorkerSignIn({
  onSignedIn,
  onBack,
}: {
  onSignedIn: (result: LoginResult) => Promise<void>;
  onBack: () => void;
}) {
  const colors = useColors();
  const { t } = useT();
  const login = trpc.auth.workerLogin.useMutation();
  const forgot = trpc.auth.workerForgotPin.useMutation();
  const [notice, setNotice] = useState<string | null>(null);
  const [mobile, setMobile] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (value: string) => {
    setError(null);
    try {
      const result = await login.mutateAsync({ mobile: mobile.trim(), pin: value });
      await onSignedIn(result);
    } catch (cause) {
      setPin("");
      // Server messages are English text keys, so they show in the worker's language.
      setError(cause instanceof Error ? t(cause.message) : t("Could not sign in."));
    }
  };
  const askNewPin = async () => {
    setError(null);
    setNotice(null);
    if (mobile.replace(/\D/g, "").length < 10) {
      setError(t("First write your mobile number above."));
      return;
    }
    try {
      const result = await forgot.mutateAsync({ mobile: mobile.trim() });
      setNotice(t(result.message));
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not send. Try again."));
    }
  };
  const pinInput = useRef<TextInput>(null);
  const typePin = (value: string) => {
    if (login.isPending) return;
    const next = value.replace(/\D/g, "").slice(0, 6);
    setPin(next);
    if (next.length === 6) void submit(next);
  };

  return (
    <View style={{ gap: 14, width: "100%" }}>
      <Text style={[styles.title, { color: colors.foreground }]}>👷 {t("Worker login")}</Text>
      <Text style={[styles.label, { color: colors.muted }]}>📱 {t("Your mobile number")}</Text>
      <TextInput
        accessibilityLabel="Mobile number"
        value={mobile}
        onChangeText={(value) => setMobile(value.replace(/[^\d+]/g, ""))}
        keyboardType="phone-pad"
        autoComplete="off"
        importantForAutofill="no"
        textContentType="none"
        returnKeyType="next"
        onSubmitEditing={() => pinInput.current?.focus()}
        maxLength={13}
        placeholder="98765 43210"
        placeholderTextColor={colors.muted}
        style={[
          styles.mobile,
          {
            color: colors.foreground,
            borderColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
      />
      <Text style={[styles.label, { color: colors.muted }]}>🔑 {t("Your 6-digit PIN")}</Text>
      {/* The dots are the PIN box: tapping them opens the phone's number keyboard. */}
      <Pressable
        accessibilityLabel={`PIN, ${pin.length} of 6 digits entered`}
        onPress={() => pinInput.current?.focus()}
        style={styles.dots}
      >
        {Array.from({ length: 6 }, (_, index) => (
          <View
            key={index}
            style={[
              styles.dot,
              {
                borderColor: colors.primary,
                backgroundColor: index < pin.length ? colors.primary : "transparent",
              },
            ]}
          />
        ))}
      </Pressable>
      <TextInput
        ref={pinInput}
        accessibilityLabel="6-digit PIN"
        value={pin}
        onChangeText={typePin}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        autoComplete="off"
        importantForAutofill="no"
        textContentType="oneTimeCode"
        editable={!login.isPending}
        caretHidden
        style={styles.hiddenPin}
      />
      {login.isPending ? <ActivityIndicator color={colors.primary} size="large" /> : null}
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text accessibilityRole="alert" style={[styles.notice, { color: colors.success }]}>
          ✅ {notice}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Forgot PIN"
        disabled={forgot.isPending}
        onPress={() => void askNewPin()}
        style={[styles.forgot, { borderColor: colors.border, backgroundColor: colors.surface }]}
      >
        {forgot.isPending ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Text style={[styles.forgotText, { color: colors.foreground }]}>
            🤔 {t("Forgot PIN? Tell supervisor")}
          </Text>
        )}
      </Pressable>
      {DEMO_MODE ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setMobile(DEMO_WORKER.mobile)}
          hitSlop={8}
        >
          <Text style={[styles.back, { color: colors.muted }]}>
            Demo: {DEMO_WORKER.mobile} · PIN {DEMO_WORKER.pin}
          </Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" onPress={onBack} hitSlop={8}>
        <Text style={[styles.back, { color: colors.primary }]}>{t("Staff sign in")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: "900", textAlign: "center" },
  label: { fontSize: 16, fontWeight: "700" },
  mobile: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 1,
  },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2 },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 14,
    paddingVertical: 14,
  },
  // Kept on screen (not display:none) so Android still opens the keyboard for it.
  hiddenPin: { position: "absolute", width: 1, height: 1, opacity: 0 },
  error: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  notice: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  forgot: { borderWidth: 1, borderRadius: 16, padding: 14, alignItems: "center" },
  forgotText: { fontSize: 17, fontWeight: "800" },
  back: { textAlign: "center", fontSize: 15, fontWeight: "700", marginTop: 4 },
});
