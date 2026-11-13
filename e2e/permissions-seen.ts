import { PERMISSIONS_ASKED_KEY } from "../lib/jp/permission-plan";

/**
 * Browser storage for tests: the one-time permission screen counts as already seen, so flows
 * start at the app itself. The permission screen has its own test.
 */
export function permissionsSeen(origin: string) {
  return {
    cookies: [],
    origins: [{ origin, localStorage: [{ name: PERMISSIONS_ASKED_KEY, value: "test" }] }],
  };
}
