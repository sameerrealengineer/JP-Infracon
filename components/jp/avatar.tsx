import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { initialsOf } from "@/components/jp/ui";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

/** A person's photo, or their initials on a coloured disc when there is no photo. */
export function Avatar({
  uri,
  name,
  size = 42,
  tone = "primary",
}: {
  uri?: string | null;
  name?: string | null;
  size?: number;
  tone?: "primary" | "gold";
}) {
  const colors = useColors();
  const background = tone === "gold" ? "#D9B76A" : colors.primary;
  const ink = tone === "gold" ? "#0E1A26" : colors.background;
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (uri)
    return (
      <Image
        source={{ uri }}
        style={[round, { backgroundColor: background }]}
        contentFit="cover"
        cachePolicy="memory-disk"
        accessibilityLabel={name ? `Photo of ${name}` : "Profile photo"}
        transition={150}
      />
    );
  return (
    <View style={[styles.disc, round, { backgroundColor: background }]}>
      <Text style={[styles.initials, { color: ink, fontSize: Math.round(size * 0.34) }]}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

/** The signed-in person's own profile, cached for a few minutes across screens. */
export function useMyProfile() {
  return trpc.jp.profile.me.useQuery(undefined, { staleTime: 4 * 60_000, retry: false });
}

const styles = StyleSheet.create({
  disc: { alignItems: "center", justifyContent: "center" },
  initials: { fontWeight: "900", letterSpacing: 0.4 },
});
