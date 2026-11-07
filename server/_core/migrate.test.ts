import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migrationTables } from "./migrate";

const folder = path.resolve(__dirname, "../../drizzle");
const migrations = readdirSync(folder).filter((name) => name.endsWith(".sql"));

describe("migrations", () => {
  it("never use a MySQL name longer than 64 characters", () => {
    // MySQL refuses longer table, column, index and constraint names, which stops the server
    // from starting (the demo uses SQLite, which does not check this).
    const tooLong: string[] = [];
    for (const file of migrations) {
      const sql = readFileSync(path.join(folder, file), "utf8");
      for (const match of sql.matchAll(/`([^`]+)`/g))
        if (match[1].length > 64) tooLong.push(`${file}: ${match[1]}`);
    }
    expect(tooLong).toEqual([]);
  });

  it("knows which migrations only create new tables (safe to repeat after a half-run)", () => {
    const purchase = readFileSync(path.join(folder, "0022_dazzling_wallflower.sql"), "utf8");
    expect(migrationTables(purchase)).toMatchObject({ changesExisting: false });
    expect(migrationTables(purchase).created).toContain("goods_receipt_lines");
    expect(
      migrationTables(
        "CREATE TABLE `a` (`id` int);\nALTER TABLE `a` ADD CONSTRAINT `x` FOREIGN KEY (`id`) REFERENCES `b`(`id`);",
      ).changesExisting,
    ).toBe(false);
    expect(migrationTables("ALTER TABLE `sites` ADD `x` int;").changesExisting).toBe(true);
    expect(
      migrationTables("CREATE TABLE `a` (`id` int);\nDROP INDEX `y` ON `b`;").changesExisting,
    ).toBe(true);
  });
});
