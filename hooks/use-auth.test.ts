// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "./use-auth";

const platform = vi.hoisted(() => ({ OS: "android" as "android" | "ios" | "web" }));
const api = vi.hoisted(() => ({ getMe: vi.fn(), logout: vi.fn() }));
const auth = vi.hoisted(() => ({
  getSessionToken: vi.fn(),
  setUserInfo: vi.fn(),
  clearUserInfo: vi.fn(),
  removeSessionToken: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: platform }));
vi.mock("@/lib/_core/api", () => api);
vi.mock("@/lib/_core/auth", () => auth);

const serverUser = {
  id: 7,
  openId: "open-7",
  name: "Site Supervisor",
  email: null,
  loginMethod: "password",
  lastSignedIn: "2026-11-01T08:30:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  platform.OS = "android";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  api.getMe.mockResolvedValue(null);
  api.logout.mockResolvedValue(undefined);
  auth.getSessionToken.mockResolvedValue(null);
  auth.setUserInfo.mockResolvedValue(undefined);
  auth.clearUserInfo.mockResolvedValue(undefined);
  auth.removeSessionToken.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("useAuth on native", () => {
  it("starts loading, then signs in the server verified user and caches the profile", async () => {
    auth.getSessionToken.mockResolvedValue("token-abc");
    api.getMe.mockResolvedValue(serverUser);

    const { result } = renderHook(() => useAuth());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toEqual({
      ...serverUser,
      lastSignedIn: new Date(serverUser.lastSignedIn),
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.error).toBeNull();
    expect(auth.setUserInfo).toHaveBeenCalledWith(result.current.user);
  });

  it("stays signed out without asking the server when there is no session token", async () => {
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(api.getMe).not.toHaveBeenCalled();
    expect(auth.clearUserInfo).toHaveBeenCalled();
  });

  it("does not trust a stored token the server rejects, and clears the cached profile", async () => {
    auth.getSessionToken.mockResolvedValue("expired-token");
    api.getMe.mockResolvedValue(null);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(auth.clearUserInfo).toHaveBeenCalled();
    expect(auth.setUserInfo).not.toHaveBeenCalled();
  });

  it("reports a failure as an error, signed out and no longer loading", async () => {
    auth.getSessionToken.mockResolvedValue("token-abc");
    api.getMe.mockRejectedValue(new Error("Network request failed"));

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.error?.message).toBe("Network request failed");
  });

  it("wraps a non Error failure in a generic error", async () => {
    auth.getSessionToken.mockRejectedValue("storage unavailable");

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe("Failed to fetch user");
  });
});

describe("useAuth on web", () => {
  it("uses the cookie session from the API without reading a native token", async () => {
    platform.OS = "web";
    api.getMe.mockResolvedValue(serverUser);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(auth.getSessionToken).not.toHaveBeenCalled();
    expect(result.current.user?.id).toBe(7);
  });

  it("clears the cached profile when the API has no signed in user", async () => {
    platform.OS = "web";

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(auth.clearUserInfo).toHaveBeenCalled();
  });
});

describe("useAuth options and actions", () => {
  it("does not load the session and is not loading when autoFetch is off", () => {
    const { result } = renderHook(() => useAuth({ autoFetch: false }));

    expect(result.current.loading).toBe(false);
    expect(result.current.user).toBeNull();
    expect(auth.getSessionToken).not.toHaveBeenCalled();
    expect(api.getMe).not.toHaveBeenCalled();
  });

  it("refresh shows loading while the session is checked again, then applies the result", async () => {
    const { result } = renderHook(() => useAuth({ autoFetch: false }));
    auth.getSessionToken.mockResolvedValue("token-abc");
    const pending = deferred<typeof serverUser>();
    api.getMe.mockReturnValue(pending.promise);

    let refreshing!: Promise<void>;
    act(() => {
      refreshing = result.current.refresh();
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      pending.resolve(serverUser);
      await refreshing;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("refresh clears an earlier error", async () => {
    auth.getSessionToken.mockResolvedValue("token-abc");
    api.getMe.mockRejectedValueOnce(new Error("Server down"));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.error).not.toBeNull());

    api.getMe.mockResolvedValue(serverUser);
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("logout removes the token and signs out even when the API call fails", async () => {
    auth.getSessionToken.mockResolvedValue("token-abc");
    api.getMe.mockResolvedValue(serverUser);
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    api.logout.mockRejectedValue(new Error("offline"));

    await act(async () => {
      await result.current.logout();
    });

    expect(auth.removeSessionToken).toHaveBeenCalled();
    expect(auth.clearUserInfo).toHaveBeenCalled();
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("never logs the session token", async () => {
    auth.getSessionToken.mockResolvedValue("secret-token-value");
    api.getMe.mockResolvedValue(serverUser);
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const logged = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls]
      .flat()
      .map(String)
      .join(" ");
    expect(logged).not.toContain("secret-token-value");
  });
});
