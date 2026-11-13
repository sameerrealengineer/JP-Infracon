import { ScrollView } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { PermissionsSetup } from "@/components/jp/permissions-setup";
import { AppHeader, Screen } from "@/components/jp/ui";
import { useT } from "@/lib/i18n";

/** More → App permissions: see and allow camera, microphone, location, files and alerts. */
export default function PermissionsScreen() {
  const { t } = useT();
  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          <AppHeader
            eyebrow={t("SETTINGS")}
            title={t("App permissions")}
            subtitle={t("Camera, microphone, location, files and alerts")}
          />
          <PermissionsSetup />
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}
