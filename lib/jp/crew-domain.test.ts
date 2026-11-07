import { describe, expect, it } from "vitest";
import { checkCrew, checkDeployment, crewCosts, joinBlocker, memberOn } from "./crew-domain";

const m = (crewId: string, personId: string, joinedOn: string, leftOn: string | null = null) => ({
  crewId,
  personId,
  joinedOn,
  leftOn,
});

describe("crew domain", () => {
  it("knows who was in a crew on a day", () => {
    const row = m("c1", "p1", "2026-11-03", "2026-11-10");
    expect(memberOn(row, "2026-11-02")).toBe(false);
    expect(memberOn(row, "2026-11-03")).toBe(true);
    expect(memberOn(row, "2026-11-10")).toBe(true);
    expect(memberOn(row, "2026-11-11")).toBe(false);
    expect(memberOn(m("c1", "p1", "2026-11-03"), "2027-01-01")).toBe(true);
  });

  it("checks names, trades and deployments", () => {
    expect(checkCrew("A", "Masonry")).toMatch(/2 letters/);
    expect(checkCrew("Shuttering team 1", "")).toMatch(/trade/);
    expect(checkCrew("Shuttering team 1", "Shuttering")).toBeNull();
    const today = "2026-11-06";
    expect(checkDeployment({ workDate: "2026-11-07", today, headcount: 5 })).toMatch(/future/);
    expect(checkDeployment({ workDate: "2026-11-06", today, headcount: 0 })).toMatch(/1 to 500/);
    expect(checkDeployment({ workDate: "2026-11-06", today, headcount: 2.5 })).toMatch(/whole/);
    expect(checkDeployment({ workDate: "06-11-2026", today, headcount: 5 })).toMatch(/valid date/);
    expect(checkDeployment({ workDate: "2026-11-05", today, headcount: 8 })).toBeNull();
  });

  it("keeps a person in one open crew per site", () => {
    const open = [m("c1", "p1", "2026-11-01"), m("c2", "p2", "2026-11-01", "2026-11-04")];
    expect(joinBlocker("p1", "c1", open)).toMatch(/already in the crew/);
    expect(joinBlocker("p1", "c2", open)).toMatch(/another crew/);
    // p2 left c2, so p2 may join again.
    expect(joinBlocker("p2", "c2", open)).toBeNull();
    expect(joinBlocker("p3", "c1", open)).toBeNull();
  });

  it("gives each day's earning to the crew the person was in that day", () => {
    const memberships = [m("c1", "p1", "2026-11-01", "2026-11-04"), m("c2", "p1", "2026-11-05")];
    const { byCrew, unassigned } = crewCosts(memberships, [
      { personId: "p1", date: "2026-11-02", minor: 70000n },
      { personId: "p1", date: "2026-11-05", minor: 70000n },
      { personId: "p1", date: "2026-11-06", minor: 35000n },
      { personId: "p2", date: "2026-11-06", minor: 60000n },
    ]);
    expect(byCrew.get("c1")).toBe(70000n);
    expect(byCrew.get("c2")).toBe(105000n);
    expect(unassigned).toBe(60000n);
  });
});
