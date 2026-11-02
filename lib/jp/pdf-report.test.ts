import { describe, expect, it } from "vitest";
import { buildReportHtml, escapeHtml } from "./pdf-report";

describe("pdf report html", () => {
  it("escapes untrusted text", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });
  it("renders meta, header and rows", () => {
    const html = buildReportHtml({
      title: "Safety & quality issues",
      meta: { Period: "2026-11-01 to 2026-11-02" },
      header: ["Site", "Title"],
      rows: [["Balugaon", "<b>Trench</b>"]],
    });
    expect(html).toContain("Safety &amp; quality issues");
    expect(html).toContain("<th>Site</th><th>Title</th>");
    expect(html).toContain("&lt;b&gt;Trench&lt;/b&gt;");
    expect(html).not.toContain("<b>Trench</b>");
  });
});
