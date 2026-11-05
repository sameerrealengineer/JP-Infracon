import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { commercialStyles as styles } from "@/components/jp/commercial-ui";
import {
  Card,
  Field,
  InlineError,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { WORKER_FEATURES, type WorkerFeature } from "@/lib/jp/worker-app";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

const FEATURE_LABEL: Record<WorkerFeature, string> = {
  money: "💰 Money (paid, due, advance)",
  attendance: "📅 Attendance",
  drawings: "📐 Site drawings",
  call: "📞 Call supervisor",
};

/**
 * Staff control for a worker's app: create the login (mobile + PIN) or reset the PIN, choose
 * what the worker can see, turn the login off, or show the worker view on this phone.
 */
export function WorkerAppCard({ siteId, personId }: { siteId: string; personId: string }) {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const utils = trpc.useUtils();
  const query = trpc.jp.worker.account.useQuery({ siteId, personId });
  const setLogin = trpc.jp.worker.setLogin.useMutation();
  const update = trpc.jp.worker.update.useMutation();
  const [editing, setEditing] = useState(false);
  const [mobile, setMobile] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (query.isLoading || query.error) return null;
  const data = query.data!;
  const account = data.account;
  const features = account?.features ?? ["money", "attendance", "call"];

  const refresh = () => utils.jp.worker.account.invalidate({ siteId, personId });
  const saveLogin = async () => {
    setError(null);
    try {
      await setLogin.mutateAsync({ siteId, personId, mobile, pin, features });
      setEditing(false);
      setPin("");
      setMessage(t("Login saved. Tell the worker their PIN in person."));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };
  const change = async (patch: { features?: WorkerFeature[]; status?: "Active" | "Disabled" }) => {
    setError(null);
    try {
      await update.mutateAsync({ siteId, personId, ...patch });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  return (
    <Card>
      <View style={styles.row}>
        <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>
          👷 {t("Worker app")}
        </Text>
        <StatusPill
          label={
            !account
              ? t("No login")
              : account.locked
                ? t("Locked")
                : account.status === "Active"
                  ? t("Active")
                  : t("Off")
          }
          tone={account?.status === "Active" && !account.locked ? "success" : "warning"}
          compact
        />
      </View>
      <Text style={[styles.meta, { color: colors.muted }]}>
        {account
          ? t("Signs in with mobile ******{last4} and a PIN.", { last4: account.mobile.slice(-4) })
          : t("Give the worker a login with their mobile number and a 6-digit PIN.")}
      </Text>
      {account && data.canManage ? (
        <>
          <Text style={[styles.meta, { color: colors.foreground, fontWeight: "700" }]}>
            {t("What the worker can see")}
          </Text>
          {WORKER_FEATURES.map((feature) => {
            const on = features.includes(feature);
            return (
              <Pressable
                key={feature}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={FEATURE_LABEL[feature]}
                onPress={() =>
                  void change({
                    features: on ? features.filter((f) => f !== feature) : [...features, feature],
                  })
                }
                style={[styles.row, { paddingVertical: 5 }]}
              >
                <Text style={{ fontSize: 18, color: on ? colors.primary : colors.muted }}>
                  {on ? "☑" : "☐"}
                </Text>
                <Text style={[styles.meta, { color: colors.foreground, marginTop: 0 }]}>
                  {t(FEATURE_LABEL[feature])}
                </Text>
              </Pressable>
            );
          })}
        </>
      ) : null}
      {data.canManage && editing ? (
        <View style={{ marginTop: 6 }}>
          <Field
            label={t("Worker's mobile number")}
            value={mobile}
            onChangeText={setMobile}
            keyboardType="phone-pad"
          />
          <Field
            label={t("New 6-digit PIN")}
            hint={t("Not 123456 or 111111. Tell it to the worker in person.")}
            value={pin}
            onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            secureTextEntry
          />
          <PrimaryButton
            icon="save"
            label={account ? t("Save new PIN") : t("Create login")}
            loading={setLogin.isPending}
            onPress={() => void saveLogin()}
          />
          <SecondaryButton label={t("Cancel")} onPress={() => setEditing(false)} />
        </View>
      ) : null}
      {data.canManage && !editing ? (
        <SecondaryButton
          icon="key"
          label={account ? t("Reset PIN") : t("Create login")}
          onPress={() => {
            setMobile(account?.mobile ?? "");
            setPin("");
            setEditing(true);
          }}
        />
      ) : null}
      {account && data.canManage ? (
        <SecondaryButton
          icon={account.status === "Active" ? "block" : "check-circle"}
          label={account.status === "Active" ? t("Turn login off") : t("Turn login on")}
          onPress={() =>
            void change({ status: account.status === "Active" ? "Disabled" : "Active" })
          }
        />
      ) : null}
      <SecondaryButton
        icon="visibility"
        label={t("Show worker view on this phone")}
        onPress={() => router.push(`/worker-view?siteId=${siteId}&personId=${personId}` as never)}
      />
      {message ? <Text style={[styles.meta, { color: colors.success }]}>{message}</Text> : null}
      {error ? <InlineError message={error} /> : null}
    </Card>
  );
}
