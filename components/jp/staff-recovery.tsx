import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

/**
 * Forgot username or password (staff): mobile → WhatsApp message with the username and a code
 * → new password. The server gives the same answer for every number.
 */
export function StaffRecovery({
  onDone,
  onBack,
}: {
  onDone: (username: string) => void;
  onBack: () => void;
}) {
  const { t } = useT();
  const colors = useColors();
  const request = trpc.auth.staffForgotLogin.useMutation();
  const reset = trpc.auth.staffResetPassword.useMutation();
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = request.isPending || reset.isPending;
  const input = [
    styles.input,
    { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border },
  ];

  const ask = async () => {
    setError(null);
    try {
      const result = await request.mutateAsync({ mobile });
      setSent(t(result.message));
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not send. Try again."));
    }
  };
  const save = async () => {
    setError(null);
    if (password !== confirm) {
      setError(t("The two passwords are not the same."));
      return;
    }
    try {
      const result = await reset.mutateAsync({ mobile, code, username, password });
      onDone(result.username);
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not save. Try again."));
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Text style={[styles.title, { color: colors.foreground }]}>
        {t("Forgot username or password")}
      </Text>
      <Text style={[styles.detail, { color: colors.muted }]}>
        {t(
          "Enter the mobile number saved in your profile. Your username and a code come on WhatsApp.",
        )}
      </Text>
      <TextInput
        accessibilityLabel={t("Mobile number")}
        value={mobile}
        onChangeText={setMobile}
        placeholder={t("Mobile number")}
        placeholderTextColor={colors.muted}
        keyboardType="phone-pad"
        style={input}
      />
      {!sent ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy || mobile.replace(/\D/g, "").length < 10}
          onPress={() => void ask()}
          style={[styles.button, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}
        >
          {busy ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={[styles.buttonText, { color: colors.background }]}>
              {t("Send code on WhatsApp")}
            </Text>
          )}
        </Pressable>
      ) : (
        <>
          <Text style={[styles.detail, { color: colors.success }]}>{sent}</Text>
          <TextInput
            accessibilityLabel={t("Code from WhatsApp")}
            value={code}
            onChangeText={setCode}
            placeholder={t("Code from WhatsApp")}
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            maxLength={6}
            style={input}
          />
          <TextInput
            accessibilityLabel={t("Username")}
            value={username}
            onChangeText={setUsername}
            placeholder={t("Username (from WhatsApp)")}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={input}
          />
          <TextInput
            accessibilityLabel={t("New password")}
            value={password}
            onChangeText={setPassword}
            placeholder={t("New password (12+ characters)")}
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoCapitalize="none"
            style={input}
          />
          <TextInput
            accessibilityLabel={t("Confirm new password")}
            value={confirm}
            onChangeText={setConfirm}
            placeholder={t("Confirm new password")}
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoCapitalize="none"
            style={input}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || code.length < 6 || !username.trim() || password.length < 12}
            onPress={() => void save()}
            style={[styles.button, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}
          >
            {busy ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.background }]}>
                {t("Set new password")}
              </Text>
            )}
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void ask()} hitSlop={8}>
            <Text style={[styles.link, { color: colors.primary }]}>{t("Send the code again")}</Text>
          </Pressable>
        </>
      )}
      {error ? (
        <Text accessibilityRole="alert" style={[styles.detail, { color: colors.error }]}>
          {error}
        </Text>
      ) : null}
      <Text style={[styles.detail, { color: colors.muted }]}>
        {t("No mobile saved, or no WhatsApp? Ask your administrator to reset your password.")}
      </Text>
      <Pressable accessibilityRole="button" onPress={onBack} hitSlop={8}>
        <Text style={[styles.link, { color: colors.primary }]}>{t("Back to sign in")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: "800" },
  detail: { fontSize: 13, lineHeight: 19 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  buttonText: { fontSize: 15, fontWeight: "800" },
  link: { fontSize: 13, fontWeight: "700", textAlign: "center" },
});
