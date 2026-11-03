import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  AppHeader,
  Card,
  ChipGroup,
  EmptyState,
  Fab,
  InlineError,
  LoadingBlock,
  Screen,
  SectionHeader,
  Sheet,
  StatusPill,
} from "@/components/jp/ui";
import { AttachmentStrip } from "@/components/jp/attachment-strip";
import { CoverPhoto, ProgressBar, percentText } from "@/components/jp/place-visual";
import {
  ProjectFormSheet,
  SiteFormSheet,
  StatusSheet,
  type ProjectDraft,
  type SiteDraft,
  type StatusTarget,
} from "@/components/jp/site-admin-forms";
import { AuthGate } from "@/components/jp/auth-gate";
import { CompanySetupNeeded, useNeedsCompanySetup } from "@/components/jp/company-setup-needed";
import { useColors } from "@/hooks/use-colors";
import { getSiteStatusTone, type SiteStatus } from "@/lib/jp/domain";
import { resolveSelectedId } from "@/lib/jp/selection";
import { trpc } from "@/lib/trpc";

export default function ProjectsScreen() {
  const colors = useColors();
  const router = useRouter();
  const overview = trpc.jp.sitesAdmin.overview.useQuery();
  const needsCompanySetup = useNeedsCompanySetup();
  const [chosenOrg, setChosenOrg] = useState<string | null>(null);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft | null>(null);
  const [siteDraft, setSiteDraft] = useState<SiteDraft | null>(null);
  const [statusTarget, setStatusTarget] = useState<StatusTarget | null>(null);
  const [gallery, setGallery] = useState<{ id: string; name: string } | null>(null);
  const cards = trpc.jp.places.cards.useQuery(undefined, { staleTime: 60_000 });
  const setCover = trpc.jp.places.setCover.useMutation();
  const utils = trpc.useUtils();
  const projectCard = (id: string) => cards.data?.projects.find((row) => row.projectId === id);
  const orgs = overview.data ?? [];
  const orgId = resolveSelectedId(orgs, chosenOrg);
  const org = orgs.find((row) => row.id === orgId);

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 110 }}
          refreshControl={
            <RefreshControl
              refreshing={overview.isRefetching}
              onRefresh={() => void overview.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader
            eyebrow="Administration"
            title="Projects & sites"
            subtitle="Create projects, add sites, update details and control whether a site accepts new work."
          />
          {overview.error ? (
            <InlineError message={overview.error.message} onRetry={() => void overview.refetch()} />
          ) : null}
          {overview.isLoading ? (
            <LoadingBlock label="Loading projects…" />
          ) : orgs.length === 0 && needsCompanySetup ? (
            <CompanySetupNeeded />
          ) : orgs.length === 0 ? (
            <EmptyState
              icon="lock-outline"
              title="Administrator access needed"
              detail="Only the Owner, Director/Partner, Contractor/Admin or Super Admin can manage projects and sites."
            />
          ) : (
            <>
              {orgs.length > 1 ? (
                <ChipGroup
                  label="Organisation"
                  options={orgs.map((row) => row.id)}
                  value={orgId}
                  onChange={setChosenOrg}
                  format={(id) => orgs.find((row) => row.id === id)?.name ?? id}
                />
              ) : null}
              <SectionHeader
                title={org ? org.name : "Projects"}
                caption={
                  org
                    ? `${org.projects.length} project${org.projects.length === 1 ? "" : "s"} · ${org.projects.reduce((sum, p) => sum + p.sites.length, 0)} sites`
                    : undefined
                }
              />
              {org && org.projects.length === 0 ? (
                <EmptyState
                  icon="add-business"
                  title="No projects yet"
                  detail="Create your first project, then add the sites where work happens."
                  action="New project"
                  onPress={() => setProjectDraft({ organizationId: org.id })}
                />
              ) : null}
              <View style={{ gap: 12 }}>
                {org?.projects.map((project) => (
                  <Card key={project.id} accent={getSiteStatusTone(project.status as SiteStatus)}>
                    {projectCard(project.id)?.coverUrl ? (
                      <View style={{ marginBottom: 12 }}>
                        <CoverPhoto
                          uri={projectCard(project.id)?.coverUrl}
                          height={140}
                          label={project.name}
                        />
                      </View>
                    ) : null}
                    <View style={styles.projectTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.code, { color: colors.accent }]}>{project.code}</Text>
                        <Text style={[styles.projectName, { color: colors.foreground }]}>
                          {project.name}
                        </Text>
                        <Text style={[styles.meta, { color: colors.muted }]}>
                          {[project.clientDepartment, project.projectType]
                            .filter(Boolean)
                            .join(" · ") || "Client not recorded"}
                        </Text>
                        {project.startDate || project.targetEndDate ? (
                          <Text style={[styles.meta, { color: colors.muted }]}>
                            {project.startDate ?? "?"} → {project.targetEndDate ?? "?"}
                          </Text>
                        ) : null}
                      </View>
                      <StatusPill
                        label={project.status}
                        tone={getSiteStatusTone(project.status as SiteStatus)}
                        compact
                      />
                    </View>
                    {projectCard(project.id)?.progress.total ? (
                      <View style={{ marginTop: 10 }}>
                        <Text style={[styles.meta, { color: colors.foreground }]}>
                          {percentText(projectCard(project.id)?.progress.actualTenths)} done ·{" "}
                          {projectCard(project.id)?.progress.completed}/
                          {projectCard(project.id)?.progress.total} tasks
                        </Text>
                        <ProgressBar
                          actualTenths={projectCard(project.id)?.progress.actualTenths ?? null}
                          expectedTenths={projectCard(project.id)?.progress.expectedTenths}
                          height={6}
                        />
                      </View>
                    ) : null}
                    <View style={[styles.siteList, { borderTopColor: colors.border }]}>
                      {project.sites.length === 0 ? (
                        <Text style={[styles.meta, { color: colors.muted }]}>
                          No sites in this project yet.
                        </Text>
                      ) : (
                        project.sites.map((site) => (
                          <Pressable
                            key={site.id}
                            accessibilityRole="button"
                            accessibilityLabel={`Open site ${site.name}`}
                            onPress={() => router.push(`/site/${site.id}` as never)}
                            style={({ pressed }) => [styles.siteRow, pressed && { opacity: 0.7 }]}
                          >
                            <MaterialIcons name="location-on" size={16} color={colors.primary} />
                            <Text
                              style={[styles.siteName, { color: colors.foreground }]}
                              numberOfLines={1}
                            >
                              {site.name}
                            </Text>
                            <Text style={[styles.meta, { color: colors.muted }]}>{site.code}</Text>
                            <StatusPill
                              label={site.status}
                              tone={getSiteStatusTone(site.status as SiteStatus)}
                              compact
                            />
                          </Pressable>
                        ))
                      )}
                    </View>
                    <View style={styles.actions}>
                      <ActionLink
                        icon="add-location-alt"
                        label="Add site"
                        disabled={project.status !== "Active"}
                        onPress={() =>
                          setSiteDraft({ projectId: project.id, projectName: project.name })
                        }
                      />
                      <ActionLink
                        icon="edit"
                        label="Edit"
                        onPress={() =>
                          setProjectDraft({
                            id: project.id,
                            organizationId: org.id,
                            code: project.code,
                            name: project.name,
                            clientDepartment: project.clientDepartment,
                            projectType: project.projectType,
                            startDate: project.startDate,
                            targetEndDate: project.targetEndDate,
                          })
                        }
                      />
                      <ActionLink
                        icon="photo-library"
                        label="Photos"
                        onPress={() => setGallery({ id: project.id, name: project.name })}
                      />
                      <ActionLink
                        icon="published-with-changes"
                        label="Status"
                        onPress={() =>
                          setStatusTarget({
                            kind: "project",
                            id: project.id,
                            name: project.name,
                            status: project.status,
                          })
                        }
                      />
                    </View>
                  </Card>
                ))}
              </View>
            </>
          )}
        </ScrollView>
        {org ? (
          <Fab label="New project" onPress={() => setProjectDraft({ organizationId: org.id })} />
        ) : null}
        <ProjectFormSheet draft={projectDraft} onClose={() => setProjectDraft(null)} />
        <SiteFormSheet draft={siteDraft} onClose={() => setSiteDraft(null)} />
        <StatusSheet target={statusTarget} onClose={() => setStatusTarget(null)} />
        {gallery ? (
          <Sheet visible title={`${gallery.name}: photos`} onClose={() => setGallery(null)}>
            <AttachmentStrip
              entityType="project"
              entityId={gallery.id}
              title="Project photos, renders and videos"
              allowVideo
              canUpload
              cover={{
                currentId: projectCard(gallery.id)?.coverAttachmentId ?? null,
                onSet: async (attachmentId) => {
                  await setCover.mutateAsync({
                    entityType: "project",
                    entityId: gallery.id,
                    attachmentId,
                  });
                  await utils.jp.places.cards.invalidate();
                },
              }}
            />
          </Sheet>
        ) : null}
      </Screen>
    </AuthGate>
  );
}

function ActionLink({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.actionLink,
        { backgroundColor: `${colors.primary}0D`, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      <MaterialIcons name={icon} size={16} color={colors.primary} />
      <Text style={[styles.actionText, { color: colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  projectTop: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  code: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  projectName: { fontSize: 17, fontWeight: "800", marginTop: 3 },
  meta: { fontSize: 12, marginTop: 3 },
  siteList: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingTop: 6 },
  siteRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9 },
  siteName: { flex: 1, fontSize: 14, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  actionLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  actionText: { fontSize: 12, fontWeight: "800" },
});
