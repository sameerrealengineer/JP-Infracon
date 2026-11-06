import Constants from "expo-constants";
import { useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import {
  AppHeader,
  Card,
  ChipGroup,
  Field,
  InlineError,
  PrimaryButton,
  Screen,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { STAFF_CATEGORIES, type StaffCategory } from "@/lib/jp/app-reports";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

/** Staff tell the admin what is wrong or what they need; the app version goes with it. */
export default function ReportProblemScreen() {
  const { t } = useT();
  const colors = useColors();
  const send = trpc.jp.feedback.send.useMutation();
  const [category, setCategory] = useState<StaffCategory>("bug");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = Constants.expoConfig?.version ?? null;

  const submit = async () => {
    setError(null);
    if (message.trim().length < 3) {
      setError(t("Write a few words about the problem."));
      return;
    }
    try {
      await send.mutateAsync({
        category,
        message: message.trim(),
        appVersion: version,
        platform: Platform.OS,
        screen: "/report-problem",
      });
      setDone(true);
      setMessage("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not send. Try again."));
    }
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView contentContainerStyle={{ paddingBottom: 36, gap: 14 }}>
          <AppHeader
            eyebrow={t("Help")}
            title={t("Report a problem")}
            subtitle={t("Your admin sees it under App problems.")}
          />
          {done ? (
            <Card accent="success">
              <Text style={{ color: colors.success, fontSize: 16, fontWeight: "800" }}>
                ✅ {t("Sent. Thank you, your admin will look at it.")}
              </Text>
            </Card>
          ) : null}
          <ChipGroup
            label={t("What is it about?")}
            options={STAFF_CATEGORIES.map((item) => item.key)}
            value={category}
            onChange={setCategory}
            format={(key) => t(STAFF_CATEGORIES.find((item) => item.key === key)?.label ?? key)}
          />
          <Field
            label={t("What happened? Which screen, what you did, what you saw.")}
            value={message}
            onChangeText={(value) => {
              setMessage(value);
              setDone(false);
            }}
            multiline
            maxLength={1000}
            placeholder={t("For example: the pay run total for Patia looks too low")}
          />
          {error ? <InlineError message={error} /> : null}
          <PrimaryButton
            icon="send"
            label={t("Send")}
            loading={send.isPending}
            disabled={send.isPending}
            onPress={() => void submit()}
          />
          <View>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {t("App version {version} on {platform} is sent with it.", {
                version: version ?? "?",
                platform: Platform.OS,
              })}
            </Text>
          </View>
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}
