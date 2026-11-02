import { useState, type ReactNode } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import * as Auth from "@/lib/_core/auth";

const companyLogo = require("../../assets/images/icon.png");

export function AuthGate({ children }: { children: ReactNode }) {
  const colors = useColors();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false, staleTime: 0 });
  const setup = trpc.auth.bootstrapStatus.useQuery(undefined, { enabled: me.data?.accountStatus !== "Active", retry: false, staleTime: 0 });
  const loginMutation = trpc.auth.login.useMutation();
  const bootstrapMutation = trpc.auth.bootstrapFirstSuperAdmin.useMutation();
  const changePasswordMutation = trpc.auth.changePassword.useMutation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const completeSignIn = async (result: { user: { id: number; openId: string; name: string | null; email: string | null; loginMethod: string; lastSignedIn: string }; sessionToken: string | null }) => {
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
      setFormError(error instanceof Error ? error.message : "Super Admin setup failed. Verify the supplied setup key and try again.");
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
      setFormError(error instanceof Error && error.message.includes("Current password") ? "The current password is incorrect." : "Password update failed. Use at least 12 characters and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (me.isLoading) return <View style={[styles.state, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /><Text style={[styles.detail, { color: colors.muted }]}>Checking your JP Infracon account…</Text></View>;
  const mustChangePassword = me.data?.accountStatus === "Active" && Boolean(me.data.mustChangePassword);
  if (me.data?.accountStatus === "Active" && !mustChangePassword) return <>{children}</>;
  if (setup.isLoading && !setup.isError) return <View style={[styles.state, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /><Text style={[styles.detail, { color: colors.muted }]}>Checking secure account setup…</Text></View>;

  const firstRun = setup.data?.initialized === false;
  const submit = mustChangePassword ? changeTemporaryPassword : firstRun ? initializeSuperAdmin : signIn;
  const disabled = submitting || (mustChangePassword
    ? !currentPassword || newPassword.length < 12 || !confirmPassword
    : !username.trim() || !password || (firstRun && (!bootstrapSecret.trim() || !displayName.trim())));

  return <KeyboardAvoidingView style={[styles.state, { backgroundColor: colors.background }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
      <Image source={companyLogo} resizeMode="contain" accessibilityLabel="JP Infracon company logo" style={styles.logo} />
      <Text style={[styles.title, { color: colors.foreground }]}>JP Infracon</Text>
      <Text style={[styles.tagline, { color: colors.primary }]}>BUILDING TODAY. SHAPING TOMORROW.</Text>
      {mustChangePassword ? <>
        <Text style={[styles.detail, { color: colors.muted }]}>Change the temporary password before continuing. Your prior sessions will be revoked.</Text>
        <TextInput accessibilityLabel="Temporary password" value={currentPassword} onChangeText={setCurrentPassword} placeholder="Temporary password" placeholderTextColor={colors.muted} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" style={[styles.input, { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border }]} />
        <TextInput accessibilityLabel="New password" value={newPassword} onChangeText={setNewPassword} placeholder="New password (12+ characters)" placeholderTextColor={colors.muted} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" style={[styles.input, { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border }]} />
        <TextInput accessibilityLabel="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Confirm new password" placeholderTextColor={colors.muted} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" style={[styles.input, { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border }]} />
      </> : firstRun ? <>
        <Text style={[styles.detail, { color: colors.muted }]}>Create the first Super Admin account. Use this app’s configured one-time setup key—not your login password. Leading and trailing spaces are ignored.</Text>
        <TextInput accessibilityLabel="Super Admin display name" value={displayName} onChangeText={setDisplayName} placeholder="Full name" placeholderTextColor={colors.muted} autoCapitalize="words" autoComplete="name" style={[styles.input, { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border }]} />
        <TextInput accessibilityLabel="Choose username" value={username} onChangeText={setUsername} placeholder="Choose username" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} textContentType="username" style={[styles.input, { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border }]} />
        <TextInput accessibilityLabel="Choose password" value={password} onChangeText={setPassword} placeholder="Choose password (12+ characters)" placeholderTextColor={colors.muted} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" style={[styles.input, { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border }]} />
        <TextInput accessibilityLabel="One-time Super Admin setup key" value={bootstrapSecret} onChangeText={setBootstrapSecret} placeholder="One-time setup key" placeholderTextColor={colors.muted} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" spellCheck={false} textContentType="none" maxLength={512} style={[styles.input, { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border }]} />
      </> : <>
        <Text style={[styles.detail, { color: colors.muted }]}>Sign in with your individual username and password. Site and organisation access is checked by the server.</Text>
        <TextInput accessibilityLabel="Username" value={username} onChangeText={setUsername} placeholder="Username" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} textContentType="username" style={[styles.input, { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border }]} />
        <TextInput accessibilityLabel="Password" value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={colors.muted} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" returnKeyType="go" onSubmitEditing={() => { void signIn(); }} style={[styles.input, { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border }]} />
      </>}
      {setup.isError ? <Text style={[styles.error, { color: colors.error }]}>Account setup status could not be reached. Check your connection and retry.</Text> : null}
      {formError ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>{formError}</Text> : null}
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => { void submit(); }} style={({ pressed }) => [styles.loginButton, { backgroundColor: disabled ? colors.border : colors.primary, opacity: pressed && !disabled ? 0.82 : 1 }]}>
        {submitting ? <ActivityIndicator color={colors.background} /> : <Text style={[styles.loginText, { color: colors.background }]}>{mustChangePassword ? "Update password" : firstRun ? "Create Super Admin account" : "Sign in"}</Text>}
      </Pressable>
      <Text style={[styles.privacy, { color: colors.muted }]}>Individual accounts only. Do not share passwords. Role and assigned-site access are enforced by the server.</Text>
      <Text style={[styles.leadership, { color: colors.muted }]}>A contracting partnership led by Jeetendra Kumar Panda, Managing Partner, and Rambabu Kumar Singh, Partner.</Text>
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  state: { flex: 1, justifyContent: "center", paddingHorizontal: 22 },
  scrollContent: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingVertical: 30, gap: 12 },
  logo: { width: 126, height: 120, marginBottom: 2 },
  title: { fontSize: 25, fontWeight: "900", textAlign: "center" },
  tagline: { fontSize: 9, fontWeight: "900", letterSpacing: 1.2, textAlign: "center", marginTop: -7, marginBottom: 9 },
  detail: { fontSize: 13, lineHeight: 19, textAlign: "center", maxWidth: 360, marginBottom: 5 },
  input: { width: "100%", maxWidth: 390, minHeight: 50, borderWidth: 1, borderRadius: 13, paddingHorizontal: 14, fontSize: 15 },
  error: { fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 360 },
  loginButton: { width: "100%", maxWidth: 390, minHeight: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 22, marginTop: 2 },
  loginText: { fontSize: 14, fontWeight: "800" },
  privacy: { fontSize: 11, lineHeight: 16, textAlign: "center", maxWidth: 360, marginTop: 4 },
  leadership: { fontSize: 10, lineHeight: 15, textAlign: "center", maxWidth: 360, marginTop: 5 },
});
