import * as Api from "@/lib/_core/api";
import * as Auth from "@/lib/_core/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

type UseAuthOptions = {
  autoFetch?: boolean;
};

type SessionResult = { user: Auth.User | null; error: Error | null };

function toUserInfo(apiUser: NonNullable<Awaited<ReturnType<typeof Api.getMe>>>): Auth.User {
  return {
    id: apiUser.id,
    openId: apiUser.openId,
    name: apiUser.name,
    email: apiUser.email,
    loginMethod: apiUser.loginMethod,
    lastSignedIn: new Date(apiUser.lastSignedIn),
  };
}

/** Resolves the server verified user (or null) and updates the cached profile. Holds no React state. */
async function loadSessionUser(): Promise<Auth.User | null> {
  // Web platform: use cookie-based auth, fetch user from API
  if (Platform.OS === "web") {
    console.log("[useAuth] Web platform: fetching user from API...");
    const apiUser = await Api.getMe();
    if (!apiUser) {
      console.log("[useAuth] Web: No authenticated user from API");
      await Auth.clearUserInfo();
      return null;
    }
    const userInfo = toUserInfo(apiUser);
    // Cache user info in localStorage for faster subsequent loads
    await Auth.setUserInfo(userInfo);
    console.log("[useAuth] Web user set from API");
    return userInfo;
  }

  // Native platform: use token-based auth.
  // Never treat a cached display profile as authentication; verify the server session first.
  console.log("[useAuth] Native platform: checking for session token...");
  const sessionToken = await Auth.getSessionToken();
  if (!sessionToken) {
    console.log("[useAuth] No session token, setting user to null");
    await Auth.clearUserInfo();
    return null;
  }

  const apiUser = await Api.getMe();
  if (!apiUser) {
    console.log("[useAuth] No server-verified native session");
    await Auth.clearUserInfo();
    return null;
  }
  const userInfo = toUserInfo(apiUser);
  await Auth.setUserInfo(userInfo);
  return userInfo;
}

async function resolveSession(): Promise<SessionResult> {
  try {
    return { user: await loadSessionUser(), error: null };
  } catch (err) {
    console.error("[useAuth] fetchUser error");
    return { user: null, error: err instanceof Error ? err : new Error("Failed to fetch user") };
  }
}

export function useAuth(options?: UseAuthOptions) {
  const { autoFetch = true } = options ?? {};
  const [user, setUser] = useState<Auth.User | null>(null);
  const [loading, setLoading] = useState(autoFetch);
  const [error, setError] = useState<Error | null>(null);

  const applySession = useCallback((result: SessionResult) => {
    setUser(result.user);
    setError(result.error);
    setLoading(false);
    console.log("[useAuth] fetchUser completed, loading:", false);
  }, []);

  const fetchUser = useCallback(async () => {
    console.log("[useAuth] fetchUser called");
    setLoading(true);
    setError(null);
    applySession(await resolveSession());
  }, [applySession]);

  const logout = useCallback(async () => {
    try {
      await Api.logout();
    } catch {
      console.error("[Auth] Logout API call failed");
      // Continue with logout even if API call fails
    } finally {
      await Auth.removeSessionToken();
      await Auth.clearUserInfo();
      setUser(null);
      setError(null);
    }
  }, []);

  const isAuthenticated = useMemo(() => Boolean(user), [user]);

  useEffect(() => {
    if (!autoFetch) return;
    console.log("[useAuth] Verifying the server session...");
    let active = true;
    void resolveSession().then((result) => {
      if (active) applySession(result);
    });
    return () => {
      active = false;
    };
  }, [autoFetch, applySession]);

  return {
    user,
    loading,
    error,
    isAuthenticated,
    refresh: fetchUser,
    logout,
  };
}
