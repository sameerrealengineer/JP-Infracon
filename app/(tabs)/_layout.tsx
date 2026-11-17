import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Tabs, useRouter } from "expo-router";
import { useEffect, type ComponentProps } from "react";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { Platform, Pressable, StyleSheet, View, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { AuthGate } from "@/components/jp/auth-gate";
import { useColors } from "@/hooks/use-colors";
import { usePushRegistration } from "@/hooks/use-push-registration";
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
  const scale = useSharedValue(focused ? 1.08 : 1);
  useEffect(() => {
    scale.value = withSpring(focused ? 1.08 : 1, { damping: 12, stiffness: 180 });
  }, [focused, scale]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View
      style={[styles.iconWrap, focused && { backgroundColor: `${colors.accent}22` }, animated]}
    >
      <MaterialIcons size={23} name={name} color={color} />
    </Animated.View>
  );
}

export default function TabLayout() {
  const colors = useColors();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 10 : Math.max(insets.bottom, 8);
  const router = useRouter();

  return (
    <AuthGate>
      <PushRegistration />
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
            title: t("Today"),
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="today" color={color} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="sites"
          options={{
            title: t("Projects"),
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="location-city" color={color} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="capture"
          options={{
            title: t("Capture"),
            tabBarAccessibilityLabel: t("Capture"),
            tabBarButton: () => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Capture")}
                onPress={() => router.push("/capture" as never)}
                style={styles.captureSlot}
              >
                <View
                  style={[
                    styles.captureButton,
                    { backgroundColor: colors.primary, shadowColor: colors.primary },
                  ]}
                >
                  <MaterialIcons name="add" size={32} color={colors.background} />
                </View>
              </Pressable>
            ),
          }}
        />
        <Tabs.Screen
          name="money"
          options={{
            title: t("Money"),
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="account-balance-wallet" color={color} focused={focused} />
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
        {/* Still reachable from Capture, Today and More; no longer in the tab bar. */}
        <Tabs.Screen name="reports" options={{ href: null, title: t("Reports") }} />
        <Tabs.Screen name="requests" options={{ href: null, title: t("Requests") }} />
      </Tabs>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  captureSlot: { flex: 1, alignItems: "center", justifyContent: "flex-start" },
  captureButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -22,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  iconWrap: {
    width: 48,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
});

/** Rendered only inside AuthGate, so it registers for push after a successful sign-in. */
function PushRegistration() {
  usePushRegistration(true);
  return null;
}
