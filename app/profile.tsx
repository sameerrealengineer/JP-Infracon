import { useT } from "@/lib/i18n";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AuthGate } from "@/components/jp/auth-gate";
import { Avatar, useMyProfile } from "@/components/jp/avatar";
import {
  AppHeader,
  Card,
  Field,
  HeroCard,
  InlineError,
  LoadingBlock,
  PrimaryButton,
  Screen,
  SectionHeader,
  Sheet,
  formatDateTime,
  type IconName,
} from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { compressPhoto } from "@/lib/device-files";
import { cleanProfile, type ProfileInput } from "@/lib/jp/profile-policy";
import { prettyRole } from "@/lib/jp/site-admin-policy";
import { trpc } from "@/lib/trpc";

type Profile = NonNullable<ReturnType<typeof useMyProfile>["data"]>;

export default function ProfileScreen() {
  const { t } = useT();
  const colors = useColors();
  const utils = trpc.useUtils();
  const profile = useMyProfile();
  const setPhoto = trpc.jp.profile.setPhoto.useMutation();
  const removePhoto = trpc.jp.profile.removePhoto.useMutation();
  const [editing, setEditing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoMenu, setPhotoMenu] = useState(false);
  const data = profile.data;

  const choosePhoto = async (source: "camera" | "gallery") => {
    setPhotoError(null);
    try {
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error("Camera permission was not given.");
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      };
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({
              ...options,
              cameraType: ImagePicker.CameraType.front,
            })
          : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets[0]) return;
      const base64 = await compressPhoto(result.assets[0].uri, 640);
      await setPhoto.mutateAsync({ base64 });
      await utils.jp.profile.me.invalidate();
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : "The photo was not saved.");
    }
  };

  return (
    <AuthGate>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={profile.isRefetching}
              onRefresh={() => void profile.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <AppHeader eyebrow="Account" title={t("My profile")} />
          {profile.error ? (
            <InlineError message={profile.error.message} onRetry={() => void profile.refetch()} />
          ) : null}
          {profile.isLoading ? <LoadingBlock label="Loading your profile…" /> : null}
          {data ? (
            <>
              <HeroCard>
                <View style={styles.hero}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Change profile photo"
                    onPress={() => setPhotoMenu(true)}
                    disabled={setPhoto.isPending || removePhoto.isPending}
                    style={({ pressed }) => [pressed && { opacity: 0.8 }]}
                  >
                    <Avatar uri={data.photoUrl} name={data.name} size={96} tone="gold" />
                    <View style={styles.cameraBadge}>
                      {setPhoto.isPending || removePhoto.isPending ? (
                        <ActivityIndicator size="small" color="#0E1A26" />
                      ) : (
                        <MaterialIcons name="photo-camera" size={18} color="#0E1A26" />
                      )}
                    </View>
                  </Pressable>
                  <Text style={styles.name}>{data.name || "Your name"}</Text>
                  <Text style={styles.role}>
                    {[data.designation, data.role ? prettyRole(data.role) : null]
                      .filter(Boolean)
                      .join(" · ") || "Add your designation"}
                  </Text>
                  {data.organizationName ? (
                    <Text style={styles.org}>{data.organizationName}</Text>
                  ) : null}
                  <View style={styles.completeTrack}>
                    <View style={[styles.completeFill, { width: `${data.completeness}%` }]} />
                  </View>
                  <Text style={styles.org}>
                    {t("Profile {percent}% complete", { percent: String(data.completeness) })}
                  </Text>
                </View>
              </HeroCard>
              {photoError ? <InlineError message={photoError} title="Photo not saved" /> : null}

              <SectionHeader title={t("Details")} />
              <Card>
                <DetailRow icon="phone-iphone" label={t("Mobile")} value={data.phone} />
                <DetailRow icon="mail-outline" label={t("Email")} value={data.email} />
                <DetailRow icon="badge" label={t("Designation")} value={data.designation} />
                <DetailRow icon="apartment" label={t("Department")} value={data.department} />
                <DetailRow icon="home" label={t("Address")} value={data.address} />
                <DetailRow
                  icon="contact-emergency"
                  label={t("Emergency contact")}
                  value={data.emergencyContact}
                />
                <DetailRow
                  icon="location-city"
                  label="Sites"
                  value={data.siteNames.length ? data.siteNames.join(", ") : null}
                />
                <DetailRow
                  icon="event"
                  label={t("Member since")}
                  value={data.memberSince ? formatDateTime(data.memberSince) : null}
                />
              </Card>
              <PrimaryButton
                icon="edit"
                label={t("Edit details")}
                onPress={() => setEditing(true)}
              />
            </>
          ) : null}
        </ScrollView>
        {photoMenu && data ? (
          <Sheet visible title={t("Profile photo")} onClose={() => setPhotoMenu(false)}>
            {Platform.OS !== "web" ? (
              <MenuRow
                icon="photo-camera"
                label={t("Take photo")}
                onPress={() => {
                  setPhotoMenu(false);
                  void choosePhoto("camera");
                }}
              />
            ) : null}
            <MenuRow
              icon="collections"
              label={t("Choose from gallery")}
              onPress={() => {
                setPhotoMenu(false);
                void choosePhoto("gallery");
              }}
            />
            {data.photoUrl ? (
              <MenuRow
                icon="delete-outline"
                label={t("Remove photo")}
                danger
                onPress={() => {
                  setPhotoMenu(false);
                  void removePhoto
                    .mutateAsync()
                    .then(() => utils.jp.profile.me.invalidate())
                    .catch((cause: unknown) =>
                      setPhotoError(cause instanceof Error ? cause.message : "Not removed."),
                    );
                }}
              />
            ) : null}
          </Sheet>
        ) : null}
        {editing && data ? (
          <EditSheet
            profile={data}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              void utils.jp.profile.me.invalidate();
              void utils.jp.notifications.preferences.invalidate();
            }}
          />
        ) : null}
      </Screen>
    </AuthGate>
  );
}

function MenuRow({
  icon,
  label,
  danger,
  onPress,
}: {
  icon: IconName;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const { t } = useT();
  const colors = useColors();
  const color = danger ? colors.error : colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.6 }]}
    >
      <MaterialIcons name={icon} size={24} color={danger ? colors.error : colors.accent} />
      <Text style={[styles.menuText, { color }]}>{label}</Text>
    </Pressable>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string | null | undefined;
}) {
  const { t } = useT();
  const colors = useColors();
  return (
    <View style={styles.detail}>
      <MaterialIcons name={icon} size={20} color={colors.accent} />
      <View style={styles.flex}>
        <Text style={[styles.detailLabel, { color: colors.muted }]}>{label}</Text>
        <Text
          style={[styles.detailValue, { color: value ? colors.foreground : colors.muted }]}
          selectable
        >
          {value || t("Not added")}
        </Text>
      </View>
    </View>
  );
}

function EditSheet({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const update = trpc.jp.profile.update.useMutation();
  const [form, setForm] = useState<ProfileInput>({
    name: profile.name ?? "",
    phone: profile.phone?.replace(/^\+91/, "") ?? "",
    designation: profile.designation ?? "",
    department: profile.department ?? "",
    addressLine: profile.addressLine ?? "",
    city: profile.city ?? "",
    district: profile.district ?? "",
    state: profile.state ?? "",
    pincode: profile.pincode ?? "",
    emergencyContact: profile.emergencyContact ?? "",
  });
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const set = (key: keyof ProfileInput) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const fieldError = (key: keyof ProfileInput) =>
    error?.field === key ? error.message : undefined;

  const save = async () => {
    const checked = cleanProfile(form);
    if ("field" in checked) return setError(checked);
    setError(null);
    try {
      await update.mutateAsync(form);
      onSaved();
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : "Not saved." });
    }
  };

  return (
    <Sheet visible title={t("Edit profile")} onClose={onClose}>
      <Field
        label="Full name"
        value={form.name}
        onChangeText={set("name")}
        error={fieldError("name")}
        autoCapitalize="words"
      />
      <Field
        label={t("Mobile")}
        value={form.phone}
        onChangeText={set("phone")}
        keyboardType="phone-pad"
        hint="Used for WhatsApp alerts when you turn them on"
        error={fieldError("phone")}
      />
      <Field
        label={t("Designation")}
        value={form.designation}
        onChangeText={set("designation")}
        placeholder="e.g. Site Engineer"
      />
      <Field
        label={t("Department")}
        value={form.department}
        onChangeText={set("department")}
        placeholder="e.g. Civil, Accounts"
      />
      <Field
        label={t("Address")}
        value={form.addressLine}
        onChangeText={set("addressLine")}
        placeholder="House, street, area"
        error={fieldError("addressLine")}
      />
      <Field label="City or village" value={form.city} onChangeText={set("city")} />
      <Field label="District" value={form.district} onChangeText={set("district")} />
      <Field label="State" value={form.state} onChangeText={set("state")} />
      <Field
        label="PIN code"
        value={form.pincode}
        onChangeText={set("pincode")}
        keyboardType="number-pad"
        maxLength={6}
        error={fieldError("pincode")}
      />
      <Field
        label={t("Emergency contact")}
        value={form.emergencyContact}
        onChangeText={set("emergencyContact")}
        placeholder="Name and mobile"
      />
      {error && !error.field ? <InlineError message={error.message} /> : null}
      <PrimaryButton
        icon="save"
        label={update.isPending ? "Saving…" : t("Save profile")}
        disabled={update.isPending}
        onPress={() => void save()}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120, gap: 12 },
  hero: { alignItems: "center", gap: 6, paddingVertical: 6 },
  name: { color: "#FFFFFF", fontSize: 22, fontWeight: "900", marginTop: 8, textAlign: "center" },
  role: { color: "#E6C987", fontSize: 13, fontWeight: "800", textAlign: "center" },
  org: { color: "rgba(246,241,230,0.75)", fontSize: 12, textAlign: "center" },
  completeTrack: {
    width: "70%",
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginTop: 8,
    overflow: "hidden",
  },
  completeFill: { height: 6, borderRadius: 3, backgroundColor: "#D9B76A" },
  cameraBadge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#D9B76A",
    borderWidth: 3,
    borderColor: "#0E1A26",
    alignItems: "center",
    justifyContent: "center",
  },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 14 },
  menuText: { fontSize: 16, fontWeight: "700" },
  flex: { flex: 1 },
  detail: { flexDirection: "row", gap: 12, alignItems: "flex-start", paddingVertical: 8 },
  detailLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  detailValue: { fontSize: 14, lineHeight: 20, marginTop: 2 },
});
