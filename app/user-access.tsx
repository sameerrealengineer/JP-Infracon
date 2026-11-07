import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { AuthGate } from "@/components/jp/auth-gate";
import { commercialStyles as styles } from "@/components/jp/commercial-ui";
import {
  AppHeader,
  Card,
  ChipGroup,
  Field,
  InlineError,
  LoadingBlock,
  Screen,
  StatusPill,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { useT } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

type Choice = "default" | "allow" | "deny";
const CHOICES: readonly Choice[] = ["default", "allow", "deny"];

/**
 * One user's access: for the whole company or one site, switch a module (or a single
 * permission) On or Off, or back to what the role gives. Off always wins.
 */
export default function UserAccessScreen() {
  const { t } = useT();
  const colors = useColors();
  const params = useLocalSearchParams<{ organizationId?: string; userId?: string }>();
  const organizationId = typeof params.organizationId === "string" ? params.organizationId : "";
  const userId = Number(params.userId ?? 0);
  const [scope, setScope] = useState<string>("company");
  const scopeType = scope === "company" ? ("organization" as const) : ("site" as const);
  const scopeId = scope === "company" ? organizationId : scope;
  const utils = trpc.useUtils();
  const access = trpc.jp.userAccess.get.useQuery(
    { organizationId, userId, scopeType, scopeId },
    { enabled: Boolean(organizationId && userId) },
  );
  const set = trpc.jp.userAccess.set.useMutation();
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const data = access.data;

  const apply = async (keys: string[], choice: Choice) => {
    setError(null);
    try {
      await set.mutateAsync({
        organizationId,
        userId,
        scopeType,
        scopeId,
        permissionKeys: keys,
        choice,
        reason: reason.trim() || null,
      });
      await utils.jp.userAccess.get.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved.");
    }
  };
  const label = (choice: Choice) =>
    choice === "default" ? t("As role") : choice === "allow" ? t("On") : t("Off");

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={access.isRefetching}
              onRefresh={() => void access.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            eyebrow={t("Access")}
            title={data?.user.name ?? t("User access")}
            subtitle={t(
              "Switch modules and actions On or Off for this person, for all sites or one site. Off always wins.",
            )}
          />
          {access.isLoading ? (
            <LoadingBlock label="Loading access…" />
          ) : !data ? (
            <InlineError
              message={access.error?.message ?? "Access could not be loaded."}
              onRetry={() => void access.refetch()}
            />
          ) : (
            <>
              <Card>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {t("Role")}: {t(data.role)} ·{" "}
                  {t("{count} changes from the role", { count: data.overrides })}
                </Text>
                <ChipGroup
                  label={t("Where")}
                  options={["company", ...data.sites.map((site) => site.id)]}
                  value={scope}
                  onChange={setScope}
                  format={(id) =>
                    id === "company"
                      ? t("All sites")
                      : (data.sites.find((site) => site.id === id)?.name ?? id)
                  }
                />
                <Field
                  label={t("Reason (kept in the audit)")}
                  value={reason}
                  onChangeText={setReason}
                />
              </Card>
              {error ? <InlineError message={error} /> : null}
              {data.groups.map((group) => {
                const keys = group.permissions
                  .filter((p) => scopeType === "organization" || !p.companyOnly)
                  .map((p) => p.key);
                if (!keys.length) return null;
                const onCount = group.permissions.filter((p) => p.effective).length;
                const allSame = group.permissions.every(
                  (p) => p.choice === group.permissions[0].choice,
                );
                const groupChoice = allSame ? group.permissions[0].choice : null;
                return (
                  <Card key={group.key}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${open === group.key ? "Hide" : "Show"} ${group.title}`}
                      onPress={() => setOpen(open === group.key ? null : group.key)}
                    >
                      <View style={styles.row}>
                        <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>
                          {t(group.title)}
                        </Text>
                        <StatusPill
                          label={`${onCount}/${group.permissions.length} ${t("on")}`}
                          tone={onCount ? "success" : "warning"}
                          compact
                        />
                      </View>
                    </Pressable>
                    <ChipGroup
                      options={
                        group.permissions.every((p) => p.canAllow)
                          ? CHOICES
                          : (["default", "deny"] as const)
                      }
                      value={groupChoice}
                      onChange={(choice) => void apply(keys, choice)}
                      format={label}
                    />
                    {open === group.key
                      ? group.permissions.map((permission) => (
                          <View key={permission.key} style={{ marginTop: 6 }}>
                            <Text style={[styles.meta, { color: colors.foreground }]}>
                              {t(permission.label)}{" "}
                              <Text
                                style={{
                                  color: permission.effective ? colors.success : colors.error,
                                }}
                              >
                                {permission.effective ? t("(on)") : t("(off)")}
                              </Text>
                            </Text>
                            <Text style={[styles.meta, { color: colors.muted, marginTop: 0 }]}>
                              {permission.roleDefault
                                ? t("Role gives it")
                                : t("Role does not give it")}
                              {permission.companyOnly ? ` · ${t("whole company only")}` : ""}
                            </Text>
                            {scopeType === "organization" || !permission.companyOnly ? (
                              <ChipGroup
                                options={
                                  permission.canAllow ? CHOICES : (["default", "deny"] as const)
                                }
                                value={permission.choice}
                                onChange={(choice) => void apply([permission.key], choice)}
                                format={label}
                              />
                            ) : null}
                          </View>
                        ))
                      : null}
                  </Card>
                );
              })}
            </>
          )}
        </ScrollView>
      </Screen>
    </AuthGate>
  );
}
