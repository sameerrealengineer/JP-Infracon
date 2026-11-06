/**
 * Crews (trade-wise teams): who was in which crew on which day, deployment checks, and each
 * crew's labour cost from approved attendance. A person is in at most one open crew per site.
 */

export const CREW_TRADES = [
  "Shuttering",
  "Bar bending",
  "Masonry",
  "Concrete",
  "Plaster",
  "Plumbing",
  "Electrical",
  "Painting",
  "Tiling",
  "Carpentry",
  "Welding",
  "Excavation",
  "Helpers",
  "Other",
] as const;

export type Membership = {
  crewId: string;
  personId: string;
  joinedOn: string;
  leftOn: string | null;
};

/** In the crew on that day: joined on or before it, and not left before it. */
export function memberOn(member: Membership, date: string) {
  return member.joinedOn <= date && (member.leftOn === null || member.leftOn >= date);
}

/** Checks a crew name and trade; returns a message or null. */
export function checkCrew(name: string, trade: string): string | null {
  const clean = name.trim();
  if (clean.length < 2) return "Give the crew a name of at least 2 letters.";
  if (clean.length > 120) return "Keep the crew name under 120 letters.";
  if (!trade.trim()) return "Choose the crew's trade.";
  if (trade.trim().length > 80) return "Keep the trade under 80 letters.";
  return null;
}

/** Checks a day's deployment; returns a message or null. */
export function checkDeployment(args: { workDate: string; today: string; headcount: number }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.workDate)) return "Choose a valid date.";
  if (args.workDate > args.today) return "A deployment cannot be for a future day.";
  if (!Number.isInteger(args.headcount) || args.headcount < 1 || args.headcount > 500)
    return "Headcount must be a whole number from 1 to 500.";
  return null;
}

/** May this person join this crew: not already open in it or in another open crew on the site. */
export function joinBlocker(
  personId: string,
  crewId: string,
  openMemberships: readonly Membership[],
): string | null {
  const open = openMemberships.filter((row) => row.personId === personId && row.leftOn === null);
  if (open.some((row) => row.crewId === crewId)) return "This person is already in the crew.";
  if (open.length) return "This person is in another crew on this site. Remove them there first.";
  return null;
}

export type DayEarning = { personId: string; date: string; minor: bigint };

/**
 * Labour cost per crew: each approved day's earning goes to the crew the person was in that day.
 * Days when the person was in no crew are returned apart as unassigned.
 */
export function crewCosts(memberships: readonly Membership[], earnings: readonly DayEarning[]) {
  const byCrew = new Map<string, bigint>();
  let unassigned = 0n;
  for (const day of earnings) {
    const member = memberships.find(
      (row) => row.personId === day.personId && memberOn(row, day.date),
    );
    if (!member) {
      unassigned += day.minor;
      continue;
    }
    byCrew.set(member.crewId, (byCrew.get(member.crewId) ?? 0n) + day.minor);
  }
  return { byCrew, unassigned };
}
