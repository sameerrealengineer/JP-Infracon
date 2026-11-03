import { describe, expect, it } from "vitest";
import { ensureSchema } from "./sql/engine";
import { createNodeDriver } from "./testing/node-driver";

describe("demo database upgrade", () => {
  it("adds columns that a newer app version expects to an older table", async () => {
    const driver = createNodeDriver();
    // A projects table as an older app version created it, with no cover column.
    await driver.exec(
      "CREATE TABLE `projects` (`id` TEXT PRIMARY KEY, `organizationId` TEXT NOT NULL, `projectCode` TEXT NOT NULL, `name` TEXT NOT NULL)",
    );
    await driver.run("INSERT INTO `projects` VALUES (?, ?, ?, ?)", ["p1", "o1", "P1", "Old"]);
    await ensureSchema(driver);
    const columns = (await driver.all("PRAGMA table_info(`projects`)", [])).map((row) => row[1]);
    expect(columns).toContain("coverAttachmentId");
    expect(columns).toContain("status");
    const rows = await driver.all(
      "SELECT `name`, `status`, `coverAttachmentId` FROM `projects`",
      [],
    );
    expect(rows).toEqual([["Old", "Active", null]]);
    // Running again changes nothing.
    await ensureSchema(driver);
  });
});
