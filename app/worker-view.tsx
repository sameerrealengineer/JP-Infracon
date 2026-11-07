import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { InlineError, LoadingBlock, Screen } from "@/components/jp/ui";
import { WorkerHome } from "@/components/jp/worker-home";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

/** A supervisor shows a worker without a smartphone their own simple screen. */
export default function WorkerViewScreen() {
  const { t } = useT();
  const colors = useColors();
  const params = useLocalSearchParams<{ siteId?: string; personId?: string }>();
  const siteId = typeof params.siteId === "string" ? params.siteId : "";
  const personId = typeof params.personId === "string" ? params.personId : "";
  const view = trpc.jp.worker.viewFor.useQuery(
    { siteId, personId },
    { enabled: Boolean(siteId && personId) },
  );
  const open = trpc.jp.worker.openDrawingFor.useMutation();
  const speak = trpc.jp.assistant.speak.useMutation();
  return (
    <AuthGate>
      <Screen>
        <View style={{ backgroundColor: colors.warning, padding: 10, borderRadius: 12 }}>
          <Text style={{ color: "#fff", fontWeight: "800", textAlign: "center" }}>
            {t("Worker view, shown on your phone")}
          </Text>
        </View>
        {view.isLoading ? (
          <LoadingBlock label="Loading…" />
        ) : !view.data ? (
          <InlineError
            message={view.error?.message ?? "Could not load."}
            onRetry={() => void view.refetch()}
          />
        ) : (
          <WorkerHome
            data={view.data}
            selfMode={false}
            openDrawing={(documentId) => open.mutateAsync({ siteId, personId, documentId })}
            speak={(text, language) => speak.mutateAsync({ text, language })}
          />
        )}
      </Screen>
    </AuthGate>
  );
}
