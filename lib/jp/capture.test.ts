import { describe, expect, it } from "vitest";
import { CAPTURE_ACTIONS, captureActionsFor } from "./capture";
import { permissionKeys } from "../../server/jp/capabilities";

describe("capture actions", () => {
  it("uses only real permission keys and unique keys", () => {
    const known = new Set<string>(permissionKeys);
    for (const action of CAPTURE_ACTIONS)
      for (const key of action.anyOf) expect(known.has(key), key).toBe(true);
    expect(new Set(CAPTURE_ACTIONS.map((a) => a.key)).size).toBe(CAPTURE_ACTIONS.length);
  });

  it("shows a supervisor only what they may do, in order, with the site in the link", () => {
    const actions = captureActionsFor(
      new Set(["site.view", "attendance.mark", "dpr.create", "material.request"]),
    );
    expect(actions.map((a) => a.key)).toEqual(["attendance", "dpr", "material", "leave"]);
    expect(actions[1]!.route("abc")).toBe("/report-editor?siteId=abc&kind=DPR");
  });
});
