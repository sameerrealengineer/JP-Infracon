import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { currentServerAddress, saveServerAddress } from "@/lib/server-address";
import { getApiBaseUrl } from "@/constants/api";
import { languageNames, useT, type Language } from "@/lib/i18n";
import * as Auth from "@/lib/_core/auth";
import { DEMO_ACCOUNTS, DEMO_MODE, DEMO_PASSWORD } from "@/lib/demo/config";
import { WorkerSelf } from "@/components/jp/worker-home";
import { WorkerSignIn } from "@/components/jp/worker-sign-in";

const companyLogo = require("../../assets/images/icon.png");

export function AuthGate({ children }: { children: ReactNode }) {
  const colors = useColors();
  const { t, language, setLanguage } = useT();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false, staleTime: 0 });
  const setup = trpc.auth.bootstrapStatus.useQuery(undefined, {
    enabled: me.data?.accountStatus !== "Active",
    retry: false,
    staleTime: 0,
  });
  const loginMutation = trpc.auth.login.useMutation();
  const queryClient = useQueryClient();
  const bootstrapMutation = trpc.auth.bootstrapFirstSuperAdmin.useMutation();
  const changePasswordMutation = trpc.auth.changePassword.useMutation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [registering, setRegistering] = useState(false);
  const [workerMode, setWorkerMode] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const registerMutation = trpc.auth.registerWithInvite.useMutation();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const completeSignIn = async (result: {
    user: {
      id: number;
      openId: string;
      name: string | null;
      email: string | null;
      loginMethod: string;
      lastSignedIn: string;
    };
    sessionToken: string | null;
  }) => {
    // A new sign-in never shows records cached for whoever used this phone before.
    queryClient.clear();
    if (result.sessionToken) await Auth.setSessionToken(result.sessionToken);
    await Auth.setUserInfo({
      id: result.user.id,
      openId: result.user.openId,
      name: result.user.name,
      email: result.user.email,
      loginMethod: result.user.loginMethod,
      lastSignedIn: new Date(result.user.lastSignedIn),
    });
    await utils.auth.me.invalidate();
    await me.refetch();
  };

  const register = async () => {
    setSubmitting(true);
    setFormError(null);
    if (password !== confirmPassword) {
      setFormError(t("The passwords do not match."));
      setSubmitting(false);
      return;
    }
    try {
      const result = await registerMutation.mutateAsync({
        code: inviteCode.trim(),
        username: username.trim(),
        password,
      });
      await completeSignIn(result);
      setInviteCode("");
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : t("Account could not be created. Check the code."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const signIn = async () => {
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await loginMutation.mutateAsync({ username: username.trim(), password });
      await completeSignIn(result);
    } catch {
      setFormError("Username or password is incorrect, or sign-in is temporarily unavailable.");
    } finally {
      setSubmitting(false);
    }
  };

  const initializeSuperAdmin = async () => {
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await bootstrapMutation.mutateAsync({
        bootstrapSecret: bootstrapSecret.trim(),
        username: username.trim(),
        displayName,
        password,
      });
      await completeSignIn(result);
      setBootstrapSecret("");
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Super Admin setup failed. Verify the supplied setup key and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const changeTemporaryPassword = async () => {
    setSubmitting(true);
    setFormError(null);
    if (newPassword !== confirmPassword) {
      setFormError("The new passwords do not match.");
      setSubmitting(false);
      return;
    }
    try {
      const result = await changePasswordMutation.mutateAsync({ currentPassword, newPassword });
      await completeSignIn(result);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      setFormError(
        error instanceof Error && error.message.includes("Current password")
          ? "The current password is incorrect."
          : "Password update failed. Use at least 12 characters and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (me.isLoading)
    return (
      <View style={[styles.state, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.detail, { color: colors.muted }]}>
          Checking your JP Infracon account…
        </Text>
      </View>
    );
  const mustChangePassword =
    me.data?.accountStatus === "Active" && Boolean(me.data.mustChangePassword);
  if (me.data?.accountStatus === "Active" && !mustChangePassword)
    // A worker login sees only the worker screen, whatever route was opened.
    return me.data.loginMethod === "worker_pin" ? <WorkerSelf /> : <>{children}</>;
  if (setup.isLoading && !setup.isError)
    return (
      <View style={[styles.state, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.detail, { color: colors.muted }]}>Checking secure account setup…</Text>
      </View>
    );

  const firstRun = setup.data?.initialized === false;
  const submit = mustChangePassword
    ? changeTemporaryPassword
    : firstRun
      ? initializeSuperAdmin
      : registering
        ? register
        : signIn;
  const disabled =
    submitting ||
    (mustChangePassword
      ? !currentPassword || newPassword.length < 12 || !confirmPassword
      : !username.trim() ||
        !password ||
        (firstRun && (!bootstrapSecret.trim() || !displayName.trim())) ||
        (registering &&
          !firstRun &&
          (inviteCode.replace(/[\s-]/g, "").length !== 10 ||
            password.length < 12 ||
            !confirmPassword)));

  return (
    <LinearGradient
      colors={["#1E3E60", "#10243A", "#070F18"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}
    >
      <KeyboardAvoidingView
        style={styles.state}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.langRow}>
            {(Object.keys(languageNames) as Language[]).map((code) => (
              <Pressable
                key={code}
                accessibilityRole="radio"
                accessibilityState={{ selected: language === code }}
                onPress={() => setLanguage(code)}
                style={[styles.langChip, language === code && styles.langChipOn]}
              >
                <Text style={[styles.langText, language === code && styles.langTextOn]}>
                  {languageNames[code]}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.logoRing}>
            <Image
              source={companyLogo}
              resizeMode="contain"
              accessibilityLabel="JP Infracon company logo"
              style={styles.logo}
            />
          </View>
          <Text style={styles.title}>JP INFRACON</Text>
          <Text style={styles.tagline}>BUILDING TODAY. SHAPING TOMORROW.</Text>
          {workerMode && !firstRun && !mustChangePassword ? (
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <WorkerSignIn onSignedIn={completeSignIn} onBack={() => setWorkerMode(false)} />
            </View>
          ) : (
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                {mustChangePassword
                  ? "Set a new password"
                  : firstRun
                    ? "Create the Super Admin"
                    : registering
                      ? t("Create your account")
                      : t("Welcome back")}
              </Text>
              {mustChangePassword ? (
                <>
                  <Text style={[styles.detail, { color: colors.muted }]}>
                    Change the temporary password before continuing. Your prior sessions will be
                    revoked.
                  </Text>
                  <TextInput
                    accessibilityLabel="Temporary password"
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    placeholder="Temporary password"
                    placeholderTextColor={colors.muted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="password"
                    style={[
                      styles.input,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                  <TextInput
                    accessibilityLabel="New password"
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="New password (12+ characters)"
                    placeholderTextColor={colors.muted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="newPassword"
                    style={[
                      styles.input,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                  <TextInput
                    accessibilityLabel="Confirm new password"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Confirm new password"
                    placeholderTextColor={colors.muted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="newPassword"
                    style={[
                      styles.input,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                </>
              ) : firstRun ? (
                <>
                  <Text style={[styles.detail, { color: colors.muted }]}>
                    Create the first Super Admin account. Use this app’s configured one-time setup
                    key—not your login password. Leading and trailing spaces are ignored.
                  </Text>
                  <TextInput
                    accessibilityLabel="Super Admin display name"
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder="Full name"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="words"
                    autoComplete="name"
                    style={[
                      styles.input,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                  <TextInput
                    accessibilityLabel="Choose username"
                    value={username}
                    onChangeText={setUsername}
                    placeholder="Choose username"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="username"
                    style={[
                      styles.input,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                  <TextInput
                    accessibilityLabel="Choose password"
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Choose password (12+ characters)"
                    placeholderTextColor={colors.muted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="newPassword"
                    style={[
                      styles.input,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                  <TextInput
                    accessibilityLabel="One-time Super Admin setup key"
                    value={bootstrapSecret}
                    onChangeText={setBootstrapSecret}
                    placeholder="One-time setup key"
                    placeholderTextColor={colors.muted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    spellCheck={false}
                    textContentType="none"
                    maxLength={512}
                    style={[
                      styles.input,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                </>
              ) : registering ? (
                <>
                  <Text style={[styles.detail, { color: colors.muted }]}>
                    {t(
                      "Enter the invite code your director or administrator gave you, then choose your own username and password.",
                    )}
                  </Text>
                  <TextInput
                    accessibilityLabel="Invite code"
                    value={inviteCode}
                    onChangeText={setInviteCode}
                    placeholder={t("Invite code (e.g. ABCDE-FGH23)")}
                    placeholderTextColor={colors.muted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    autoComplete="off"
                    style={[
                      styles.input,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                  <TextInput
                    accessibilityLabel="Choose username"
                    value={username}
                    onChangeText={setUsername}
                    placeholder={t("Choose a username")}
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="username"
                    style={[
                      styles.input,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                  <TextInput
                    accessibilityLabel="Choose password"
                    value={password}
                    onChangeText={setPassword}
                    placeholder={t("Password (12+ characters)")}
                    placeholderTextColor={colors.muted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="newPassword"
                    style={[
                      styles.input,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                  <TextInput
                    accessibilityLabel="Confirm password"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder={t("Confirm password")}
                    placeholderTextColor={colors.muted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="newPassword"
                    style={[
                      styles.input,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                </>
              ) : (
                <>
                  <Text style={[styles.detail, { color: colors.muted }]}>
                    {t("Sign in with the username and password your administrator gave you.")}
                  </Text>
                  <TextInput
                    accessibilityLabel="Username"
                    value={username}
                    onChangeText={setUsername}
                    placeholder={t("Username")}
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="username"
                    style={[
                      styles.input,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                  <TextInput
                    accessibilityLabel="Password"
                    value={password}
                    onChangeText={setPassword}
                    placeholder={t("Password")}
                    placeholderTextColor={colors.muted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="password"
                    returnKeyType="go"
                    onSubmitEditing={() => {
                      void signIn();
                    }}
                    style={[
                      styles.input,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                </>
              )}
              {setup.isError ? (
                <Text style={[styles.error, { color: colors.error }]}>
                  Account setup status could not be reached. Check your connection and retry.
                </Text>
              ) : null}
              {formError ? (
                <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
                  {formError}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={disabled}
                onPress={() => {
                  void submit();
                }}
                style={({ pressed }) => [
                  styles.loginButton,
                  {
                    backgroundColor: disabled ? colors.border : colors.primary,
                    opacity: pressed && !disabled ? 0.82 : 1,
                  },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color={colors.background} />
                ) : (
                  <Text style={[styles.loginText, { color: colors.background }]}>
                    {mustChangePassword
                      ? "Update password"
                      : firstRun
                        ? "Create Super Admin account"
                        : registering
                          ? t("Create account")
                          : t("Sign in")}
                  </Text>
                )}
              </Pressable>
              {!mustChangePassword && !firstRun ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setRegistering((value) => !value);
                    setFormError(null);
                    setPassword("");
                    setConfirmPassword("");
                  }}
                  hitSlop={8}
                >
                  <Text style={[styles.switchLink, { color: colors.primary }]}>
                    {registering
                      ? t("Already have an account? Sign in")
                      : t("Have an invite code? Create account")}
                  </Text>
                </Pressable>
              ) : null}
              <Text style={[styles.privacy, { color: colors.muted }]}>
                {t("Individual accounts only. Never share your password.")}
              </Text>
            </View>
          )}
          {!workerMode && !firstRun && !mustChangePassword && !registering ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setWorkerMode(true);
                setFormError(null);
              }}
              style={[styles.workerButton, { backgroundColor: colors.surface }]}
            >
              <Text style={[styles.workerButtonText, { color: colors.foreground }]}>
                👷 {t("Mistri / worker login (mobile + PIN)")}
              </Text>
            </Pressable>
          ) : null}
          {DEMO_MODE ? (
            !mustChangePassword && !registering ? (
              <DemoAccounts
                selected={username}
                onPick={(name) => {
                  setUsername(name);
                  setPassword(DEMO_PASSWORD);
                  setFormError(null);
                }}
              />
            ) : null
          ) : (
            <ServerAddress
              onChanged={() => {
                void utils.auth.me.invalidate();
                void setup.refetch();
              }}
            />
          )}
          <Text style={styles.leadership}>
            Led by Jeetendra Kumar Panda, Managing Partner, and Rambabu Kumar Singh, Partner.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  state: { flex: 1, justifyContent: "center", paddingHorizontal: 20 },
  workerButton: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  workerButtonText: { fontSize: 18, fontWeight: "900", textAlign: "center" },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 36,
    gap: 12,
  },
  demoBox: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 20,
    padding: 16,
    gap: 10,
    marginTop: 4,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  demoTitle: { color: "#F6F1E6", fontSize: 15, fontWeight: "800" },
  demoHint: { color: "rgba(246,241,230,0.75)", fontSize: 12, lineHeight: 17 },
  demoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  demoChip: {
    flexGrow: 1,
    flexBasis: "45%",
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  demoChipOn: { backgroundColor: "#F6F1E6", borderColor: "#F6F1E6" },
  demoChipLabel: { color: "#F6F1E6", fontSize: 13, fontWeight: "700" },
  demoChipUser: { color: "rgba(246,241,230,0.7)", fontSize: 11, marginTop: 2 },
  demoChipLabelOn: { color: "#0E1A26" },
  serverBox: { width: "100%", maxWidth: 420, alignItems: "center", gap: 8, marginTop: 6 },
  serverText: { color: "rgba(246,241,230,0.7)", fontSize: 11, textDecorationLine: "underline" },
  serverInput: {
    width: "100%",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#FFFFFF",
  },
  serverError: { color: "#FF8A80", fontSize: 12 },
  serverSave: {
    backgroundColor: "#D9B76A",
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  serverSaveText: { color: "#0E1A26", fontWeight: "800" },
  langRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  langChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  langChipOn: { backgroundColor: "#D9B76A", borderColor: "#D9B76A" },
  langText: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "700" },
  langTextOn: { color: "#0E1A26" },
  logoRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#D9B76A",
    marginBottom: 6,
    overflow: "hidden",
  },
  logo: { width: 84, height: 84 },
  title: {
    fontSize: 28,
    fontFamily: "PlayfairDisplay_700Bold",
    textAlign: "center",
    color: "#FFFFFF",
    letterSpacing: 4,
  },
  tagline: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    textAlign: "center",
    color: "#D9B76A",
    marginTop: -6,
    marginBottom: 12,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 26,
    padding: 22,
    gap: 12,
    alignItems: "center",
  },
  cardTitle: { fontSize: 23, fontFamily: "PlayfairDisplay_700Bold", alignSelf: "flex-start" },
  detail: { fontSize: 13, lineHeight: 19, alignSelf: "flex-start", marginBottom: 4 },
  input: {
    width: "100%",
    maxWidth: 390,
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  switchLink: { fontSize: 13, fontWeight: "800", marginTop: 4 },
  error: { fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 360 },
  loginButton: {
    width: "100%",
    maxWidth: 390,
    minHeight: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
    marginTop: 2,
  },
  loginText: { fontSize: 14, fontWeight: "800" },
  privacy: { fontSize: 11, lineHeight: 16, textAlign: "center", maxWidth: 360, marginTop: 4 },
  leadership: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    maxWidth: 340,
    marginTop: 10,
    color: "rgba(246,241,230,0.65)",
  },
});

/** Offline demo: tap a role to fill in its sign-in. Every demo account shares one password. */
function DemoAccounts({
  selected,
  onPick,
}: {
  selected: string;
  onPick: (username: string) => void;
}) {
  return (
    <View style={styles.demoBox}>
      <Text style={styles.demoTitle}>Demo accounts</Text>
      <Text style={styles.demoHint}>
        Tap a role to sign in as that person. Password for all: {DEMO_PASSWORD}
      </Text>
      <View style={styles.demoGrid}>
        {DEMO_ACCOUNTS.map((account) => {
          const on = selected.trim().toLowerCase() === account.username;
          return (
            <Pressable
              key={account.username}
              accessibilityRole="button"
              accessibilityLabel={`Use the ${account.label} demo account`}
              onPress={() => onPick(account.username)}
              style={[styles.demoChip, on && styles.demoChipOn]}
            >
              <Text style={[styles.demoChipLabel, on && styles.demoChipLabelOn]}>
                {account.label}
              </Text>
              <Text style={[styles.demoChipUser, on && styles.demoChipLabelOn]}>
                {account.username}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.demoHint}>
        Everything is stored on this phone only. Nothing is sent to a server.
      </Text>
    </View>
  );
}

/** Shows which server the app talks to; lets the user point an installed APK at their server. */
function ServerAddress({ onChanged }: { onChanged: () => void }) {
  // An APK built without a server address opens this box so the address can be entered.
  const [editing, setEditing] = useState(() => Platform.OS !== "web" && !getApiBaseUrl());
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(currentServerAddress);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      setCurrent(await saveServerAddress(value));
      setEditing(false);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.serverBox}>
      <Pressable accessibilityRole="button" onPress={() => setEditing((v) => !v)} hitSlop={8}>
        <Text style={styles.serverText}>
          Server · {current.replace(/^https?:\/\//, "")} · {editing ? "Close" : "Change"}
        </Text>
      </Pressable>
      {editing ? (
        <>
          <TextInput
            accessibilityLabel="Server address"
            value={value}
            onChangeText={setValue}
            placeholder="https://api.your-company.com"
            placeholderTextColor="rgba(255,255,255,0.45)"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.serverInput}
          />
          {error ? <Text style={styles.serverError}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy || !value.trim()}
            onPress={() => void save()}
            style={styles.serverSave}
          >
            {busy ? (
              <ActivityIndicator color="#0E1A26" />
            ) : (
              <Text style={styles.serverSaveText}>Check & save</Text>
            )}
          </Pressable>
        </>
      ) : null}
    </View>
  );
}
