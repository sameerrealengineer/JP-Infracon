import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Profile, photos/videos on places, covers and progress over the demo SQLite database.
vi.mock("../../server/db", () => import("./server/db"));
vi.mock("../../server/_core/sdk", () => import("./server/sdk"));
vi.mock("../../server/storage", () => import("./server/storage"));

const { setDemoDriver } = await import("./runtime");
const { createNodeDriver } = await import("./testing/node-driver");
const { ensureDemoData } = await import("./backend");
const { signIn } = await import("./seed");

type Caller = Awaited<ReturnType<typeof signIn>>;
const mutationId = () => `test-${randomUUID()}`;
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0]).toString(
  "base64",
);
const mp4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypmp42"),
  Buffer.alloc(32),
]).toString("base64");

let owner: Caller, supervisor: Caller;
let siteId: string, projectId: string;

describe("profile and media", () => {
  beforeAll(async () => {
    await setDemoDriver(createNodeDriver());
    await ensureDemoData();
    [owner, supervisor] = await Promise.all(["owner", "supervisor"].map(signIn));
    const sites = await supervisor.jp.workspace.mySites();
    siteId = sites[0].id;
    projectId = sites[0].projectId;
  }, 120_000);

  it("keeps a profile with mobile, address and photo", async () => {
    await expect(
      supervisor.jp.profile.update({
        name: "Demo Supervisor",
        phone: "98765 43210",
        designation: "Site Engineer",
        department: "",
        addressLine: "Plot 12",
        city: "Pakalapoli",
        district: "Khurda",
        state: "Odisha",
        pincode: "0520",
        emergencyContact: "",
      }),
    ).rejects.toThrow(/PIN/);
    await supervisor.jp.profile.update({
      name: "Demo Supervisor",
      phone: "98765 43210",
      designation: "Site Engineer",
      department: "Civil",
      addressLine: "Plot 12",
      city: "Pakalapoli",
      district: "Khurda",
      state: "Odisha",
      pincode: "752055",
      emergencyContact: "Father 9876500000",
    });
    const photo = await supervisor.jp.profile.setPhoto({ base64: jpeg });
    expect(photo.photoUrl).toBeTruthy();
    const me = await supervisor.jp.profile.me();
    expect(me).toMatchObject({
      phone: "+919876543210",
      designation: "Site Engineer",
      address: "Plot 12, Pakalapoli, Khurda, Odisha 752055",
      role: "supervisor",
      completeness: 100,
    });
    expect(me.photoUrl).toBeTruthy();
    const prefs = await supervisor.jp.notifications.preferences();
    expect(prefs.phone).toBe("+919876543210");
    const team = await owner.jp.profile.team();
    expect(team.find((row) => row.role === "supervisor")).toMatchObject({
      designation: "Site Engineer",
    });
    await expect(supervisor.jp.profile.setPhoto({ base64: mp4 })).rejects.toThrow(/photo/);
  });

  it("adds a site photo and video, and only a manager sets the cover", async () => {
    const photo = await supervisor.jp.attachments.upload({
      entityType: "site",
      entityId: siteId,
      fileName: "slab.jpg",
      base64: jpeg,
      sourceType: "Selected from device",
      clientMutationId: mutationId(),
    });
    await supervisor.jp.attachments.upload({
      entityType: "site",
      entityId: siteId,
      fileName: "walkthrough.mp4",
      base64: mp4,
      sourceType: "Selected from device",
      clientMutationId: mutationId(),
    });
    const files = await owner.jp.attachments.list({ entityType: "site", entityId: siteId });
    expect(files.map((file) => file.contentType).sort()).toEqual(["image/jpeg", "video/mp4"]);
    await expect(
      supervisor.jp.places.setCover({
        entityType: "site",
        entityId: siteId,
        attachmentId: photo.id,
      }),
    ).rejects.toThrow(/manage/);
    const video = files.find((file) => file.contentType === "video/mp4")!;
    await expect(
      owner.jp.places.setCover({ entityType: "site", entityId: siteId, attachmentId: video.id }),
    ).rejects.toThrow(/photos/);
    await owner.jp.places.setCover({
      entityType: "site",
      entityId: siteId,
      attachmentId: photo.id,
    });
    const cards = await supervisor.jp.places.cards();
    const card = cards.sites.find((row) => row.siteId === siteId)!;
    expect(card.coverUrl).toBeTruthy();
    expect(card.progress.total).toBeGreaterThan(0);
    expect(cards.projects.find((row) => row.projectId === projectId)).toBeTruthy();
  });

  it("files can be added to a project and a task", async () => {
    await owner.jp.attachments.upload({
      entityType: "project",
      entityId: projectId,
      fileName: "render.jpg",
      base64: jpeg,
      sourceType: "Selected from device",
      clientMutationId: mutationId(),
    });
    expect(
      await supervisor.jp.attachments.list({ entityType: "project", entityId: projectId }),
    ).toHaveLength(1);
    const schedule = await supervisor.jp.places.schedule({ siteId });
    expect(schedule.tasks.length).toBeGreaterThan(0);
    const task = schedule.tasks[0];
    expect(task.progressTenths).toBeGreaterThanOrEqual(0);
    await supervisor.jp.attachments.upload({
      entityType: "work_task",
      entityId: task.id,
      fileName: "rebar.jpg",
      base64: jpeg,
      sourceType: "Selected from device",
      clientMutationId: mutationId(),
    });
    expect(
      await owner.jp.attachments.list({ entityType: "work_task", entityId: task.id }),
    ).toHaveLength(1);
  });
});
