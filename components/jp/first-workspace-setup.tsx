import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { PrimaryButton } from "@/components/jp/ui";

export function FirstWorkspaceSetup({
  visible,
  onClose,
  onComplete,
}: {
  visible: boolean;
  onClose: () => void;
  onComplete: () => void;
}) {
  const colors = useColors();
  const utils = trpc.useUtils();
  const [organizationName, setOrganizationName] = useState("");
  const [organizationCode, setOrganizationCode] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteCode, setSiteCode] = useState("");
  const [address, setAddress] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const create = trpc.jp.workspace.initializeFirstWorkspace.useMutation();

  const submit = async () => {
    setErrorMessage(null);
    try {
      await create.mutateAsync({
        organizationName,
        organizationCode,
        projectName,
        projectCode,
        siteName,
        siteCode,
        address: address || undefined,
      });
      await Promise.all([
        utils.jp.workspace.mySites.invalidate(),
        utils.jp.workspace.dashboard.invalidate(),
        utils.jp.workspace.onboardingState.invalidate(),
      ]);
      setOrganizationName("");
      setOrganizationCode("");
      setProjectName("");
      setProjectCode("");
      setSiteName("");
      setSiteCode("");
      setAddress("");
      onClose();
      onComplete();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Workspace setup did not complete. No record was confirmed.",
      );
    }
  };

  const inputStyle = [
    styles.input,
    { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border },
  ];
  const field = (
    label: string,
    value: string,
    setter: (value: string) => void,
    placeholder: string,
    autoCapitalize: "sentences" | "characters" = "sentences",
  ) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={setter}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCapitalize !== "characters"}
        style={inputStyle}
      />
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}
        >
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.kicker, { color: colors.primary }]}>FIRST-TIME SETUP</Text>
              <Text style={[styles.title, { color: colors.foreground }]}>Create the workspace</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close setup"
              onPress={onClose}
            >
              <MaterialIcons name="close" size={23} color={colors.foreground} />
            </Pressable>
          </View>
          <Text style={[styles.intro, { color: colors.muted }]}>
            This creates organisation, project, and site records and gives the authenticated owner
            an organisation role. Enter the real operational details for the client workspace.
          </Text>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 12 }}
          >
            {field(
              "Organisation name",
              organizationName,
              setOrganizationName,
              "Organisation legal or operating name",
            )}
            {field(
              "Organisation code",
              organizationCode,
              setOrganizationCode,
              "Unique code, e.g. JP-INFRACON",
              "characters",
            )}
            {field("Project name", projectName, setProjectName, "Project name")}
            {field(
              "Project code",
              projectCode,
              setProjectCode,
              "Unique project code",
              "characters",
            )}
            {field("First site name", siteName, setSiteName, "Site or work-package name")}
            {field("Site code", siteCode, setSiteCode, "Unique site code", "characters")}
            {field("Address (optional)", address, setAddress, "Site location")}
            {errorMessage ? (
              <Text style={[styles.error, { color: colors.error }]}>{errorMessage}</Text>
            ) : null}
            <PrimaryButton
              icon="domain-add"
              label={create.isPending ? "Creating workspace…" : "Create workspace"}
              disabled={create.isPending}
              onPress={submit}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(10,20,18,0.56)" },
  sheet: {
    maxHeight: "92%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 20,
    paddingBottom: 26,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 10 },
  kicker: { fontSize: 10, letterSpacing: 1.4, fontWeight: "900" },
  title: { fontSize: 21, fontWeight: "900", marginTop: 4 },
  intro: { fontSize: 12, lineHeight: 18, marginBottom: 14 },
  field: { marginBottom: 12 },
  label: { fontSize: 11, fontWeight: "800", marginBottom: 6 },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 14 },
  error: { fontSize: 12, lineHeight: 17, marginBottom: 12 },
});
