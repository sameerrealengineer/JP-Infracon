import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { DEMO_MODE, DEMO_WORKER } from "@/lib/demo/config";

type LoginResult = Awaited<
  ReturnType<ReturnType<typeof trpc.auth.workerLogin.useMutation>["mutateAsync"]>
>;

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"] as const;

/**
 * Worker sign-in: mobile number, then the 6-digit PIN on big number keys. Signs in by itself
 * when the sixth digit is pressed.
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
  const press = (key: (typeof KEYS)[number]) => {
    if (login.isPending) return;
    if (key === "⌫") return setPin((value) => value.slice(0, -1));
    if (key === "✓") return pin.length === 6 ? void submit(pin) : undefined;
    const next = (pin + key).slice(0, 6);
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
      <View style={styles.dots} accessibilityLabel={`${pin.length} of 6 digits entered`}>
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
      </View>
      <View style={styles.pad}>
        {KEYS.map((key) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={key === "⌫" ? "Delete" : key === "✓" ? "Sign in" : key}
            onPress={() => press(key)}
            style={({ pressed }) => [
              styles.key,
              {
                backgroundColor:
                  key === "✓" ? colors.success : pressed ? colors.primary : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.keyText, { color: key === "✓" ? "#fff" : colors.foreground }]}>
              {key}
            </Text>
          </Pressable>
        ))}
      </View>
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
  dots: { flexDirection: "row", justifyContent: "center", gap: 14, marginVertical: 4 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2 },
  pad: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  key: {
    width: "31%",
    height: 64,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  keyText: { fontSize: 28, fontWeight: "900" },
  error: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  notice: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  forgot: { borderWidth: 1, borderRadius: 16, padding: 14, alignItems: "center" },
  forgotText: { fontSize: 17, fontWeight: "800" },
  back: { textAlign: "center", fontSize: 15, fontWeight: "700", marginTop: 4 },
});
