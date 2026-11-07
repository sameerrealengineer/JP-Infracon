import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { AUTH_ME_KEY, isSignedOutError, markSignedOut } from "./session-expiry";

describe("session expiry", () => {
  it("recognises only the signed-out refusal", () => {
    expect(isSignedOutError(new Error(UNAUTHED_ERR_MSG))).toBe(true);
    expect(isSignedOutError(new Error("Username or password is incorrect"))).toBe(false);
    expect(isSignedOutError("Please login (10001)")).toBe(false);
  });

  it("replaces a cached signed-in account with null", () => {
    const client = new QueryClient();
    client.setQueryData(AUTH_ME_KEY, { id: 1, accountStatus: "Active" });
    markSignedOut(client);
    expect(client.getQueryData(AUTH_ME_KEY)).toBeNull();
  });
});
