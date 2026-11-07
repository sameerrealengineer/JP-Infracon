// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useThemeContext } from "./theme-provider";

const store = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => void store.set(key, value),
  },
}));
vi.mock("react-native", () => ({
  Appearance: { setColorScheme: () => undefined },
  Platform: {
    OS: "android",
    select: (options: Record<string, unknown>) => options.android ?? options.default,
  },
  View: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  useColorScheme: () => "light",
}));
vi.mock("nativewind", () => ({ colorScheme: { set: () => undefined }, vars: () => ({}) }));

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(ThemeProvider, null, children);

beforeEach(() => store.clear());

describe("ThemeProvider", () => {
  it("starts from the phone's scheme when nothing was chosen", () => {
    const { result } = renderHook(() => useThemeContext(), { wrapper });
    expect(result.current.colorScheme).toBe("light");
  });

  it("restores Midnight after the app is reopened", async () => {
    const first = renderHook(() => useThemeContext(), { wrapper });
    act(() => first.result.current.setColorScheme("dark"));
    await waitFor(() => expect(store.size).toBe(1));
    first.unmount();

    const reopened = renderHook(() => useThemeContext(), { wrapper });
    await waitFor(() => expect(reopened.result.current.colorScheme).toBe("dark"));
  });

  it("ignores a corrupted saved value", async () => {
    store.set("jp-infracon.theme.v1", "purple");
    const { result } = renderHook(() => useThemeContext(), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current.colorScheme).toBe("light");
  });
});
