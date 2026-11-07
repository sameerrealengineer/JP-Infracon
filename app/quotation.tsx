import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { QUOTE_TONE, TotalRow, commercialStyles as styles } from "@/components/jp/commercial-ui";
import {
  AppHeader,
  Card,
  Field,
  InlineError,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
  StatusPill,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { formatPercent, formatQuantity } from "@/lib/jp/billing-domain";
import { formatMinorAsRupees } from "@/lib/jp/finance-domain";
import { createClientMutationId } from "@/lib/jp/local-repository";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

const NEXT: Record<string, ("Sent" | "Accepted" | "Rejected" | "Expired")[]> = {
  Draft: ["Sent"],
  Sent: ["Accepted", "Rejected", "Expired"],
  Expired: ["Sent"],
};

/** A quotation with its items, totals and status actions. */
export default function QuotationScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const quotationId = typeof params.id === "string" ? params.id : "";
  const utils = trpc.useUtils();
  const lookups = trpc.jp.crm.lookups.useQuery();
  const detail = trpc.jp.crm.quotations.detail.useQuery(
    { quotationId },
    { enabled: Boolean(quotationId) },
  );
  const setStatus = trpc.jp.crm.quotations.setStatus.useMutation();
  const [key, setKey] = useState(createClientMutationId);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const data = detail.data;

  const change = async (status: "Sent" | "Accepted" | "Rejected" | "Expired") => {
    setError(null);
    try {
      await setStatus.mutateAsync({
        quotationId,
        status,
        reason: reason.trim() || null,
        clientMutationId: key,
      });
      setKey(createClientMutationId());
      setReason("");
      await Promise.all([
        utils.jp.crm.quotations.detail.invalidate(),
        utils.jp.crm.quotations.list.invalidate(),
        utils.jp.crm.leads.list.invalidate(),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={detail.isRefetching}
              onRefresh={() => void detail.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          {detail.isLoading ? (
            <LoadingBlock label="Loading quotation…" />
          ) : !data ? (
            <>
              <AppHeader eyebrow={t("Quotation")} title={t("Not available")} />
              <InlineError
                message={detail.error?.message ?? "This quotation could not be opened."}
                onRetry={() => void detail.refetch()}
              />
            </>
          ) : (
            <>
              <AppHeader
                eyebrow={data.quotation.quotationNumber}
                title={data.quotation.title}
                subtitle={`${data.client.name} · ${String(data.quotation.quotationDate)}${
                  data.quotation.validUntil
                    ? ` · ${t("valid until")} ${String(data.quotation.validUntil)}`
                    : ""
                }`}
              />
              <Card>
                <View style={styles.row}>
                  <StatusPill
                    label={t(data.quotation.status)}
                    tone={QUOTE_TONE[data.quotation.status] ?? "info"}
                  />
                  <Text style={[styles.money, { color: colors.foreground, textAlign: "right" }]}>
                    {formatMinorAsRupees(data.quotation.totalMinor)}
                  </Text>
                </View>
                {data.client.gstin ? (
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    GSTIN {data.client.gstin}
                  </Text>
                ) : null}
              </Card>

              <SectionHeader title={t("Items")} />
              <Card>
                {data.lines.map((line) => (
                  <View key={line.id} style={{ paddingVertical: 6 }}>
                    <Text style={[styles.title, { color: colors.foreground, fontSize: 14 }]}>
                      {line.itemCode ? `${line.itemCode} · ` : ""}
                      {line.description}
                    </Text>
                    <View style={styles.totalRow}>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {formatQuantity(line.quantityThousandths)} {line.unit} ×{" "}
                        {formatMinorAsRupees(line.rateMinor)}
                      </Text>
                      <Text style={[styles.meta, { color: colors.foreground, fontWeight: "700" }]}>
                        {formatMinorAsRupees(line.amountMinor)}
                      </Text>
                    </View>
                  </View>
                ))}
                <TotalRow
                  label={t("Subtotal")}
                  value={formatMinorAsRupees(data.quotation.subtotalMinor)}
                />
                <TotalRow
                  label={`${t("GST")} ${formatPercent(data.quotation.gstBps)}`}
                  value={formatMinorAsRupees(data.quotation.gstMinor)}
                />
                <TotalRow
                  label={t("Total")}
                  value={formatMinorAsRupees(data.quotation.totalMinor)}
                  strong
                />
              </Card>
              {data.quotation.terms ? (
                <Card>
                  <Text style={[styles.meta, { color: colors.muted }]}>{data.quotation.terms}</Text>
                </Card>
              ) : null}

              {lookups.data?.canManage && NEXT[data.quotation.status]?.length ? (
                <Card>
                  <Field
                    label={t("Note (needed for Rejected)")}
                    value={reason}
                    onChangeText={setReason}
                    multiline
                  />
                  {NEXT[data.quotation.status].map((status) =>
                    status === "Accepted" || status === "Sent" ? (
                      <PrimaryButton
                        key={status}
                        icon={status === "Accepted" ? "check-circle" : "send"}
                        label={t(status === "Sent" ? "Mark as sent to client" : "Client accepted")}
                        loading={setStatus.isPending}
                        onPress={() => void change(status)}
                      />
                    ) : (
                      <SecondaryButton
                        key={status}
                        label={t(status === "Rejected" ? "Client rejected" : "Mark expired")}
                        onPress={() => void change(status)}
                      />
                    ),
                  )}
                </Card>
              ) : null}
              {data.quotation.status === "Accepted" ? (
                <PrimaryButton
                  icon="receipt-long"
                  tone="gold"
                  label={t("Use as project contract for billing")}
                  onPress={() => router.push(`/billing?quotationId=${data.quotation.id}` as never)}
                />
              ) : null}
              {error ? <InlineError message={error} /> : null}
            </>
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}
