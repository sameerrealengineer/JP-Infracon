import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Platform, StyleSheet, View, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { AuthGate } from "@/components/jp/auth-gate";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { useT } from "@/lib/i18n";

type IconName = ComponentProps<typeof MaterialIcons>["name"];

function TabIcon({
  name,
  color,
  focused,
}: {
  name: IconName;
  color: ColorValue;
  focused: boolean;
}) {
  const colors = useColors();
  return (
    <View style={[styles.iconWrap, focused && { backgroundColor: `${colors.accent}22` }]}>
      <MaterialIcons size={23} name={name} color={color} />
    </View>
  );
}

export default function TabLayout() {
  const colors = useColors();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 10 : Math.max(insets.bottom, 8);
  const capabilities = trpc.jp.workspace.myCapabilities.useQuery();
  const canOpenReports =
    capabilities.data?.some(
      (item) => item["dpr.view"] || item["dpr.create"] || item["dlr.view"] || item["dlr.create"],
    ) ?? false;
  const canOpenRequests =
    capabilities.data?.some((item) => item["material.request.view"] || item["material.request"]) ??
    false;

  return (
    <AuthGate>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.muted,
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarStyle: {
            paddingTop: 8,
            paddingBottom: bottomPadding,
            height: 64 + bottomPadding,
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderTopWidth: StyleSheet.hairlineWidth,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: "700", marginTop: 2 },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t("Home"),
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="space-dashboard" color={color} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="sites"
          options={{
            title: t("Sites"),
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="location-city" color={color} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="reports"
          options={{
            href: canOpenReports ? undefined : null,
            title: t("Reports"),
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="assignment" color={color} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="requests"
          options={{
            href: canOpenRequests ? undefined : null,
            title: t("Requests"),
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="local-shipping" color={color} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: t("More"),
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="apps" color={color} focused={focused} />
            ),
          }}
        />
      </Tabs>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 48,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
});
