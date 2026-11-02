// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useColorScheme } from "./use-color-scheme.web";

const system = vi.hoisted(() => ({ scheme: "dark" as "dark" | "light" | null }));
vi.mock("react-native", () => ({ useColorScheme: () => system.scheme }));

function SchemeProbe() {
  return createElement("span", null, String(useColorScheme()));
}

beforeEach(() => {
  system.scheme = "dark";
});

describe("useColorScheme (web)", () => {
  it("renders light during static rendering so the HTML matches the first client render", () => {
    expect(renderToString(createElement(SchemeProbe))).toBe("<span>light</span>");
  });

  it("returns the device scheme once running in the browser", () => {
    const { result } = renderHook(() => useColorScheme());

    expect(result.current).toBe("dark");
  });

  it("passes through a missing device preference after hydration", () => {
    system.scheme = null;

    const { result } = renderHook(() => useColorScheme());

    expect(result.current).toBeNull();
  });
});
