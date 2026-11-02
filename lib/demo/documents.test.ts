import { randomUUID } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Runs the real document procedures over the demo's SQLite database (never the shared MySQL).
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
const mutationId = () => `test-${randomUUID()}`;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

let owner: Caller, supervisor: Caller, auditor: Caller;
let projectId: string, siteA: string;

async function indexed(caller: Caller, documentId: string) {
  for (let i = 0; i < 50; i += 1) {
    const detail = await caller.jp.documents.detail({ documentId });
    if (detail.document.indexStatus !== "Pending") return detail;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Indexing did not finish");
}

describe("project documents and smart search", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, supervisor, auditor] = await Promise.all(
      ["owner", "supervisor", "auditor"].map(signIn),
    );
    const options = await owner.jp.documents.options();
    siteA = options.sites.find((site) => site.name.length > 0)!.id;
    projectId = options.sites.find((site) => site.id === siteA)!.projectId;
  }, 120_000);

  it("uploads a bill, indexes its text without AI and finds it by invoice number", async () => {
    const csv = strToU8(
      "Invoice,INV-2026-0042\nSupplier,Odisha Cement Works\nItem,OPC 53 cement\n",
    );
    const created = await supervisor.jp.documents.upload({
      projectId,
      siteId: siteA,
      category: "Bills and invoices",
      title: "Cement bill October",
      tags: "cement, October",
      fileName: "bill.csv",
      base64: b64(csv),
      clientMutationId: mutationId(),
    });
    const detail = await indexed(supervisor, created.id);
    expect(detail.document.indexStatus).toBe("Keyword only");
    expect(detail.versions).toHaveLength(1);
    expect(detail.versions[0].fileName).toBe("bill.csv");

    const found = await auditor.jp.documents.search({ query: "INV-2026-0042" });
    expect(found.mode).toBe("keyword");
    expect(found.results[0]?.id).toBe(created.id);
    expect(found.results[0]?.excerpt).toContain("INV-2026-0042");
    expect(
      (await auditor.jp.documents.search({ query: "structural steel drawing" })).results,
    ).toEqual([]);
  });

  it("reads Word files and keeps every version", async () => {
    const docx = zipSync({
      "word/document.xml": strToU8(
        "<w:document><w:body><w:p><w:r><w:t>Work order WO-17 for boundary wall</w:t></w:r></w:p></w:body></w:document>",
      ),
    });
    const created = await owner.jp.documents.upload({
      projectId,
      category: "Agreements and work orders",
      title: "Work order WO-17",
      fileName: "wo17.docx",
      base64: b64(docx),
      clientMutationId: mutationId(),
    });
    await indexed(owner, created.id);
    const second = await owner.jp.documents.upload({
      projectId,
      documentId: created.id,
      category: "Agreements and work orders",
      title: "ignored for a new version",
      note: "Revised quantities",
      fileName: "wo17-rev1.docx",
      base64: b64(docx),
      clientMutationId: mutationId(),
    });
    expect(second.versionNumber).toBe(2);
    const detail = await indexed(owner, created.id);
    expect(detail.document.title).toBe("Work order WO-17");
    expect(detail.versions.map((row) => row.versionNumber)).toEqual([2, 1]);
    expect((await owner.jp.documents.search({ query: "boundary wall" })).results[0]?.id).toBe(
      created.id,
    );
    const link = await auditor.jp.documents.open({ documentId: created.id, versionNumber: 1 });
    expect(link.url).toBeTruthy();
  });

  it("rejects files that are not documents, and respects roles", async () => {
    await expect(
      supervisor.jp.documents.upload({
        projectId,
        siteId: siteA,
        category: "Other project documents",
        title: "Program",
        fileName: "run.csv",
        base64: b64(new Uint8Array([0x4d, 0x5a, 0x00, 0x00, 0x01])),
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow("Upload a PDF");
    await expect(
      auditor.jp.documents.upload({
        projectId,
        siteId: siteA,
        category: "Other project documents",
        title: "Not allowed",
        fileName: "a.csv",
        base64: b64(strToU8("a,b")),
        clientMutationId: mutationId(),
      }),
    ).rejects.toThrow();
    const [bill] = await supervisor.jp.documents.list({ category: "Bills and invoices" });
    await expect(
      supervisor.jp.documents.setStatus({ documentId: bill.id, status: "Archived", reason: "Old" }),
    ).rejects.toThrow();
  });

  it("archiving hides a document from lists and search until restored", async () => {
    const [bill] = await owner.jp.documents.list({ category: "Bills and invoices" });
    await owner.jp.documents.setStatus({
      documentId: bill.id,
      status: "Archived",
      reason: "Duplicate upload",
    });
    expect((await owner.jp.documents.list({})).some((row) => row.id === bill.id)).toBe(false);
    expect((await owner.jp.documents.search({ query: "INV-2026-0042" })).results).toEqual([]);
    expect((await owner.jp.documents.list({ status: "Archived" }))[0].id).toBe(bill.id);
    await owner.jp.documents.setStatus({ documentId: bill.id, status: "Active", reason: "Needed" });
    expect((await owner.jp.documents.search({ query: "INV-2026-0042" })).results[0]?.id).toBe(
      bill.id,
    );
  });
});
