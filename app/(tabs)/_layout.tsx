import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Platform } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { AuthGate } from "@/components/jp/auth-gate";
import { trpc } from "@/lib/trpc";

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);
  const tabBarHeight = 56 + bottomPadding;
  const capabilities = trpc.jp.workspace.myCapabilities.useQuery();
  const canOpenReports = capabilities.data?.some((item) => item["dpr.view"] || item["dpr.create"] || item["dlr.view"] || item["dlr.create"]) ?? false;
  const canOpenRequests = capabilities.data?.some((item) => item["material.request.view"] || item["material.request"]) ?? false;

  return (
    <AuthGate>
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          paddingTop: 8,
          paddingBottom: bottomPadding,
          height: tabBarHeight,
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <MaterialIcons size={23} name="home" color={color} />,
        }}
      />
      <Tabs.Screen name="sites" options={{ title: "Sites", tabBarIcon: ({ color }) => <MaterialIcons size={23} name="domain" color={color} /> }} />
      <Tabs.Screen name="reports" options={{ href: canOpenReports ? undefined : null, title: "Reports", tabBarIcon: ({ color }) => <MaterialIcons size={23} name="description" color={color} /> }} />
      <Tabs.Screen name="requests" options={{ href: canOpenRequests ? undefined : null, title: "Requests", tabBarIcon: ({ color }) => <MaterialIcons size={23} name="inventory-2" color={color} /> }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: ({ color }) => <MaterialIcons size={23} name="more-horiz" color={color} /> }} />
    </Tabs>
    </AuthGate>
  );
}
