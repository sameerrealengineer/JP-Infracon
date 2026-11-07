import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_TOPICS, START_PATHS, startPathFor, topicByKey, visibleTopics } from "./help-content";

const root = path.resolve(__dirname, "../..");
const screenExists = (route: string) => {
  const clean = route.split("?")[0].replace(/^\//, "");
  return existsSync(path.join(root, "app", `${clean}.tsx`));
};
// The server's permission list, read as text so this test needs no database code.
const serverKeys = new Set(
  [
    ...readFileSync(path.join(root, "server/jp/capabilities.ts"), "utf8").matchAll(
      /"([a-z_]+(?:\.[a-z_]+)+)"/g,
    ),
  ].map((match) => match[1]),
);

describe("help content", () => {
  it("points every topic and step at a screen that exists", () => {
    for (const topic of HELP_TOPICS) expect(screenExists(topic.route), topic.route).toBe(true);
    for (const steps of Object.values(START_PATHS))
      for (const step of steps) expect(screenExists(step.route), step.route).toBe(true);
  });

  it("uses only permissions the server knows", () => {
    const used = [
      ...HELP_TOPICS.flatMap((topic) => topic.anyOf),
      ...Object.values(START_PATHS).flatMap((steps) => steps.flatMap((step) => step.anyOf)),
    ];
    for (const key of used) expect(serverKeys.has(key), key).toBe(true);
  });

  it("has unique keys and full text for every topic", () => {
    expect(new Set(HELP_TOPICS.map((topic) => topic.key)).size).toBe(HELP_TOPICS.length);
    for (const topic of HELP_TOPICS)
      for (const field of [topic.title, topic.what, topic.who, topic.first, topic.next])
        expect(field.length).toBeGreaterThan(3);
    expect(topicByKey("billing")?.route).toBe("/billing");
    expect(topicByKey("nothing")).toBeNull();
  });

  it("shows only topics the person can use, and picks a start path by role", () => {
    const supervisor = (...keys: string[]) =>
      keys.some((key) => ["dpr.view", "attendance.view"].includes(key));
    const keys = visibleTopics(supervisor).map((topic) => topic.key);
    expect(keys).toContain("reports");
    expect(keys).toContain("sites");
    expect(keys).not.toContain("billing");
    expect(startPathFor("owner")).toBe("leader");
    expect(startPathFor("project_manager")).toBe("manager");
    expect(startPathFor("supervisor")).toBe("supervisor");
    expect(startPathFor("storekeeper")).toBe("store");
    expect(startPathFor(null)).toBe("supervisor");
  });
});
