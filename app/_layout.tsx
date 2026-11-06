import "@/global.css";
import "@/lib/geofence-task";
import { QueryClient, focusManager } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { parse as superjsonParse, stringify as superjsonStringify } from "superjson";
import { Stack, router, usePathname, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { AppState, Platform, Pressable, ScrollView, Text, View } from "react-native";
import "@/lib/_core/nativewind-pressable";
import { ThemeProvider } from "@/lib/theme-provider";
import {
  PlayfairDisplay_600SemiBold,
  PlayfairDisplay_700Bold,
  useFonts,
} from "@expo-google-fonts/playfair-display";
import { LanguageProvider, translateNow } from "@/lib/i18n";
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Metrics, Rect } from "react-native-safe-area-context";

import { trpc, createTRPCClient } from "@/lib/trpc";
import { useConnectivity } from "@/hooks/use-connectivity";
import { loadServerAddress } from "@/lib/server-address";
import { useIssueDraftSync } from "@/hooks/use-issue-draft-sync";
import { initManusRuntime, subscribeSafeAreaInsets } from "@/lib/_core/manus-runtime";
import { installGlobalErrorReporting, reportAppError, setErrorScreen } from "@/lib/error-reporter";

installGlobalErrorReporting();

// On phones there is no window focus: tell React Query when the app comes to the foreground.
if (Platform.OS !== "web")
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener("change", (state) =>
      handleFocus(state === "active"),
    );
    return () => subscription.remove();
  });

/** Remembers the open screen, so an error report says where it happened. */
function ScreenTracker() {
  const pathname = usePathname();
  useEffect(() => {
    setErrorScreen(pathname);
  }, [pathname]);
  return null;
}

/**
 * Shown when a screen crashes: a plain message, the error, and buttons to try again or go home.
 * The error is sent to the admins by itself.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    reportAppError(error);
  }, [error]);
  return (
    <ScrollView
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, gap: 14 }}
      style={{ backgroundColor: "#fff" }}
    >
      <Text style={{ fontSize: 44, textAlign: "center" }}>⚠️</Text>
      <Text style={{ fontSize: 22, fontWeight: "800", textAlign: "center", color: "#1f2937" }}>
        {translateNow("This screen had a problem")}
      </Text>
      <Text style={{ fontSize: 16, textAlign: "center", color: "#4b5563" }}>
        {translateNow(
          "Your saved work is safe. The problem has been sent to your admin. Try again, or go back to the home screen.",
        )}
      </Text>
      <View
        style={{ backgroundColor: "#fef2f2", borderRadius: 12, padding: 12 }}
        accessibilityLabel="Error details"
      >
        <Text selectable style={{ color: "#991b1b", fontSize: 13 }}>
          {error.message}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => void retry()}
        style={{ backgroundColor: "#1d4ed8", borderRadius: 14, padding: 16, alignItems: "center" }}
      >
        <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800" }}>
          🔄 {translateNow("Try again")}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          try {
            router.replace("/" as never);
          } catch {
            void retry();
          }
        }}
        style={{
          borderColor: "#d1d5db",
          borderWidth: 1,
          borderRadius: 14,
          padding: 16,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#1f2937", fontSize: 17, fontWeight: "700" }}>
          🏠 {translateNow("Go to home screen")}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function ConnectivitySync() {
  const { online } = useConnectivity();
  // Drafts saved offline are sent as soon as the phone reconnects.
  useIssueDraftSync(online);
  return null;
}

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };

export const unstable_settings = {
  anchor: "(tabs)",
};

export default function RootLayout() {
  // Headings switch to the serif once loaded; the app never waits on the font.
  useFonts({ PlayfairDisplay_600SemiBold, PlayfairDisplay_700Bold });
  const initialInsets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const initialFrame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;

  const [insets, setInsets] = useState<EdgeInsets>(initialInsets);
  const [frame, setFrame] = useState<Rect>(initialFrame);

  // Initialize Manus runtime for cookie injection from parent container
  useEffect(() => {
    initManusRuntime();
  }, []);

  const handleSafeAreaUpdate = useCallback((metrics: Metrics) => {
    setInsets(metrics.insets);
    setFrame(metrics.frame);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const unsubscribe = subscribeSafeAreaInsets(handleSafeAreaUpdate);
    return () => unsubscribe();
  }, [handleSafeAreaUpdate]);

  // Create clients once and reuse them
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Refresh when the app comes back to the foreground (wired to AppState below), so a
            // change made by someone else (an approval, a payment) shows up.
            refetchOnWindowFocus: true,
            // Retry failed requests once
            retry: 1,
            // Keep previously loaded records for offline viewing (restored from device storage).
            gcTime: 7 * 24 * 60 * 60 * 1000,
            // Short: screens refetch when opened, so they show what others just changed.
            staleTime: 5_000,
          },
        },
      }),
  );
  const [trpcClient] = useState(() => createTRPCClient());
  // The saved server address must be known before the first request.
  const [addressReady, setAddressReady] = useState(false);
  useEffect(() => {
    let active = true;
    void loadServerAddress().then(() => {
      if (active) setAddressReady(true);
    });
    return () => {
      active = false;
    };
  }, []);
  const [persister] = useState(() =>
    createAsyncStoragePersister({
      storage: AsyncStorage,
      key: "jp-infracon.query-cache.v1",
      serialize: (data) => superjsonStringify(data),
      deserialize: (data) => superjsonParse(data),
      throttleTime: 2000,
    }),
  );

  // Ensure minimum 8px padding for top and bottom on mobile
  const providerInitialMetrics = useMemo(() => {
    const metrics = initialWindowMetrics ?? { insets: initialInsets, frame: initialFrame };
    return {
      ...metrics,
      insets: {
        ...metrics.insets,
        top: Math.max(metrics.insets.top, 16),
        bottom: Math.max(metrics.insets.bottom, 12),
      },
    };
  }, [initialInsets, initialFrame]);

  const content = !addressReady ? null : (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            buster: "jp-1",
            dehydrateOptions: {
              // Only successful reads are kept; bootstrap/setup state is always fetched fresh.
              shouldDehydrateQuery: (query) =>
                query.state.status === "success" &&
                !JSON.stringify(query.queryKey).includes("bootstrapStatus"),
            },
          }}
        >
          <ConnectivitySync />
          <ScreenTracker />
          {/* Default to hiding native headers so raw route segments don't appear (e.g. "(tabs)", "products/[id]"). */}
          {/* If a screen needs the native header, explicitly enable it and set a human title via Stack.Screen options. */}
          {/* in order for ios apps tab switching to work properly, use presentation: "fullScreenModal" for login page, whenever you decide to use presentation: "modal*/}
          <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
          <StatusBar style="auto" />
        </PersistQueryClientProvider>
      </trpc.Provider>
    </GestureHandlerRootView>
  );

  const shouldOverrideSafeArea = Platform.OS === "web";

  if (shouldOverrideSafeArea) {
    return (
      <ThemeProvider>
        <LanguageProvider>
          <SafeAreaProvider initialMetrics={providerInitialMetrics}>
            <SafeAreaFrameContext.Provider value={frame}>
              <SafeAreaInsetsContext.Provider value={insets}>
                {content}
              </SafeAreaInsetsContext.Provider>
            </SafeAreaFrameContext.Provider>
          </SafeAreaProvider>
        </LanguageProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <LanguageProvider>
        <SafeAreaProvider initialMetrics={providerInitialMetrics}>{content}</SafeAreaProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
