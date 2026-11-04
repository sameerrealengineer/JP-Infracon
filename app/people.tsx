import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { Avatar } from "@/components/jp/avatar";
import {
  AppHeader,
  Card,
  EmptyState,
  InlineError,
  LoadingBlock,
  Screen,
  StatusPill,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

const TYPE_LABEL: Record<string, string> = {
  worker: "Worker",
  technician: "Technician",
  subcontractor_contact: "Subcontractor",
};

/** Search workers, technicians and subcontractors by name, trade or phone. */
export default function PeopleScreen() {
  const { t } = useT();
  const colors = useColors();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const search = trpc.jp.people.search.useQuery(
    { query: query.trim() },
    { placeholderData: (previous) => previous },
  );
  const rows = search.data?.people ?? [];

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={search.isRefetching}
              onRefresh={() => void search.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            eyebrow={t("Workforce")}
            title={t("People directory")}
            subtitle={t(
              "Find anyone who worked with you: sites, attendance, pay, quality and contact.",
            )}
          />
          <View
            style={[styles.search, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <MaterialIcons name="search" size={20} color={colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("Name, trade or phone")}
              placeholderTextColor={colors.muted}
              accessibilityLabel={t("Search people")}
              autoCorrect={false}
              style={[styles.searchInput, { color: colors.foreground }]}
            />
          </View>
          {search.error ? (
            <InlineError message={search.error.message} onRetry={() => void search.refetch()} />
          ) : null}
          {search.isLoading ? (
            <LoadingBlock label="Searching…" />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="person-search"
              title={query ? "Nobody found" : "No people yet"}
              detail={
                query
                  ? "Try part of the name, the trade (mason, helper) or the phone number."
                  : "People added in Workforce for your sites appear here."
              }
            />
          ) : (
            <View style={{ gap: 10 }}>
              {rows.map((person) => (
                <Card
                  key={person.id}
                  onPress={() => router.push(`/person?id=${person.id}` as never)}
                  accessibilityLabel={`Open ${person.fullName}`}
                >
                  <View style={styles.row}>
                    <Avatar name={person.fullName} size={44} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.name, { color: colors.foreground }]}>
                        {person.fullName}
                      </Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {[
                          t(TYPE_LABEL[person.personType] ?? "Worker"),
                          person.tradeType,
                          t(person.skillCategory),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                      <View style={styles.badges}>
                        {person.averageRating !== null ? (
                          <View style={styles.badge}>
                            <MaterialIcons name="star" size={14} color={colors.accent} />
                            <Text style={[styles.meta, { color: colors.foreground, marginTop: 0 }]}>
                              {person.averageRating.toFixed(1)}
                            </Text>
                          </View>
                        ) : null}
                        {person.defaults > 0 ? (
                          <StatusPill
                            label={t("{count} defaults", { count: person.defaults })}
                            tone="error"
                            compact
                          />
                        ) : null}
                      </View>
                    </View>
                    <StatusPill
                      label={t(person.status)}
                      tone={person.status === "Active" ? "success" : "warning"}
                      compact
                    />
                  </View>
                </Card>
              ))}
            </View>
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32, gap: 12 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 50,
  },
  searchInput: { flex: 1, fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { fontSize: 16, fontWeight: "800" },
  meta: { fontSize: 12, marginTop: 3 },
  badges: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  badge: { flexDirection: "row", alignItems: "center", gap: 3 },
});
