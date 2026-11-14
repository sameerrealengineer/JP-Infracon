/**
 * Photos, drawings and documents for the start data, through the real upload procedures.
 * Real: the Kalyan Mandap photo from jpinfracon.com as its cover; the website's overhead tank
 * photo as the Sheragada project cover (an example tank, as the website says). SAMPLE: stage
 * illustrations (labelled as drawings, not photos), two dimensioned drawings, and Word, Excel
 * and PDF documents of different kinds.
 */
import { randomUUID } from "node:crypto";
import media from "./media.json";
import type { SeedCaller } from "./client-data";
import { simplePdf } from "./client-data";
import { makeDocx, makeXlsx } from "./office-files";

const id = () => `seed-${randomUUID()}`;
const S = "SAMPLE · ";

type Ids = {
  kalyan: { projectId: string; siteId: string };
  sheragada: { projectId: string; siteIds: string[] };
};

async function photo(
  boss: SeedCaller,
  entityType: "site" | "project",
  entityId: string,
  fileName: string,
  base64: string,
) {
  const made = await boss.jp.attachments.upload({
    entityType,
    entityId,
    fileName,
    base64,
    sourceType: "Selected from device",
    clientMutationId: id(),
  });
  return made.id as string;
}

/** Real: the two photos from the company website, set as covers. */
export async function addRealPhotos(boss: SeedCaller, ids: Ids) {
  const building = await photo(
    boss,
    "site",
    ids.kalyan.siteId,
    "kalyan-mandap-aska.jpg",
    media.photos.kalyanMandap,
  );
  await boss.jp.places.setCover({
    entityType: "site",
    entityId: ids.kalyan.siteId,
    attachmentId: building,
  });
  const projectPhoto = await photo(
    boss,
    "project",
    ids.kalyan.projectId,
    "kalyan-mandap-aska.jpg",
    media.photos.kalyanMandap,
  );
  await boss.jp.places.setCover({
    entityType: "project",
    entityId: ids.kalyan.projectId,
    attachmentId: projectPhoto,
  });
  const tank = await photo(
    boss,
    "project",
    ids.sheragada.projectId,
    "example-overhead-tank.jpg",
    media.photos.exampleTank,
  );
  await boss.jp.places.setCover({
    entityType: "project",
    entityId: ids.sheragada.projectId,
    attachmentId: tank,
  });
}

/** SAMPLE: stage illustrations on each site, drawings and documents. */
export async function addSampleMedia(boss: SeedCaller, ids: Ids) {
  for (const [index, picture] of media.illustrations.entries()) {
    const tank = picture.place.startsWith("oht") ? Number(picture.place.slice(3)) : 0;
    const siteId = tank ? ids.sheragada.siteIds[tank - 1]! : ids.kalyan.siteId;
    const slug = picture.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await photo(
      boss,
      "site",
      siteId,
      `sample-illustration-${String(index + 1).padStart(2, "0")}-${slug}.jpg`,
      picture.jpeg,
    );
  }

  const upload = (
    projectId: string,
    siteId: string,
    category: string,
    title: string,
    fileName: string,
    bytes: Buffer,
    tags: string,
  ) =>
    boss.jp.documents.upload({
      projectId,
      siteId,
      category: category as never,
      title: `${S}${title}`,
      tags: `${tags}, sample`,
      fileName,
      base64: bytes.toString("base64"),
      clientMutationId: id(),
    });
  const k = ids.kalyan;
  const sh = { projectId: ids.sheragada.projectId, siteId: ids.sheragada.siteIds[0]! };

  // Drawings (the drawing reader can read rooms and sizes from these).
  await upload(
    k.projectId,
    k.siteId,
    "Drawings",
    "Ground floor plan, Kalyan Mandap",
    "sample-ground-floor-plan.png",
    Buffer.from(media.drawings.kalyanPlan, "base64"),
    "drawing, plan, ground floor",
  );
  await upload(
    sh.projectId,
    sh.siteId,
    "Drawings",
    "Overhead tank elevation, 100 KL",
    "sample-oht-elevation.png",
    Buffer.from(media.drawings.ohtElevation, "base64"),
    "drawing, elevation, oht",
  );

  // Word documents.
  await upload(
    k.projectId,
    k.siteId,
    "Agreements and work orders",
    "Agreement: G+1 Govt Kalyan Mandap, Aska",
    "sample-agreement-kalyan-mandap.docx",
    makeDocx("SAMPLE AGREEMENT - G+1 Govt Kalyan Mandap, Pakalapoli, Aska", [
      "Between: Block Development Office, Aska (Employer) and JP Infracon (Contractor).",
      "Work: Construction of G+1 Kalyan Mandap as per drawings, specifications and BOQ.",
      "Contract value: as per the accepted BOQ, plus GST at 18%.",
      "Time for completion: 6 months from the date of the work order.",
      "Payment: monthly running account (RA) bills; 5% retention until handover; TDS 2%.",
      "Liquidated damages: 0.5% of the contract value per week of delay, up to 10%.",
      "Defect liability period: 12 months from handover.",
      "Disputes: first to the Engineer-in-charge, then arbitration at Berhampur.",
      "This is an example for training only. Replace it with the signed agreement.",
    ]),
    "agreement, contract",
  );
  await upload(
    k.projectId,
    k.siteId,
    "Agreements and work orders",
    "Work order: masonry to Pahalad Mason Works",
    "sample-wo-pahalad.docx",
    makeDocx("SAMPLE WORK ORDER - Brickwork and plaster", [
      "To: Pahalad Mason Works, Berhampur",
      "Scope: fly ash brick masonry and 12 mm plaster, labour with tools.",
      "Rates: masonry Rs 1,650 per cum; plaster Rs 85 per sqm.",
      "Retention 5%, TDS 1%, mobilisation advance Rs 20,000 recovered at 20% per bill.",
    ]),
    "work order, subcontract",
  );
  await upload(
    k.projectId,
    k.siteId,
    "Other project documents",
    "Letter: request for extension of time",
    "sample-eot-letter.docx",
    makeDocx("SAMPLE LETTER - Request for extension of time", [
      "To: Block Development Officer, Aska",
      "Subject: Extension of time by 30 days due to heavy rain in September.",
      "Rain records and daily reports for 9 rain days are attached.",
    ]),
    "letter, extension of time",
  );
  await upload(
    sh.projectId,
    sh.siteId,
    "Agreements and work orders",
    "Agreement: O&M of rural piped water supply, Sheragada",
    "sample-agreement-sheragada.docx",
    makeDocx("SAMPLE AGREEMENT - Rural piped water supply, Sheragada Block", [
      "Employer: RWS & S Division, Berhampur. Contractor: JP Infracon (holder: Sri Jeetendra Kumar Panda).",
      "Scope: rural piped water supply works covering 9 villages, with 5 years of operation and maintenance.",
      "Contract value: Rs 2,95,55,914 excluding GST (2022-23).",
      "Maintenance: repair and replacement as defined in the agreement; tank repainting by separate order.",
      "Example text for training only. Replace it with the signed agreement.",
    ]),
    "agreement, o&m, water supply",
  );
  await upload(
    sh.projectId,
    sh.siteId,
    "Completion certificates",
    "Tank handover certificate, OHT-01",
    "sample-oht01-handover.docx",
    makeDocx("SAMPLE HANDOVER - OHT-01 repainting and renovation", [
      "Inside epoxy coating, outside weather coat, ladder and railing, new sluice valves: complete.",
      "Tank filled and tested: no leaks. Chlorine 0.5 ppm, turbidity 1 NTU after filling.",
      "Handed back to the village water committee.",
    ]),
    "handover, oht-01",
  );

  // Excel workbooks.
  await upload(
    k.projectId,
    k.siteId,
    "Measurements",
    "Measurement book abstract",
    "sample-measurement-book.xlsx",
    makeXlsx("MB abstract", [
      ["Item", "Description", "Unit", "Measured", "BOQ quantity"],
      ["1.1", "Earthwork excavation", "cum", 420, 420],
      ["2.1", "PCC M10", "cum", 38, 38],
      ["3.1", "RCC M20", "cum", 265, 265],
      ["4.1", "Brick masonry", "cum", 310, 310],
      ["5.1", "Plaster 12 mm", "sqm", 2850, 2850],
    ]),
    "measurement, mb",
  );
  await upload(
    k.projectId,
    k.siteId,
    "Other project documents",
    "Material reconciliation: cement and steel",
    "sample-material-reconciliation.xlsx",
    makeXlsx("Reconciliation", [
      ["Material", "Unit", "Received", "Theoretical use", "Actual use", "Wastage %"],
      ["PPC cement", "bag", 3850, 3780, 3812, 0.85],
      ["TMT steel", "kg", 32100, 31500, 31720, 0.7],
    ]),
    "reconciliation, cement, steel",
  );
  await upload(
    k.projectId,
    k.siteId,
    "Other project documents",
    "Labour register, last month",
    "sample-labour-register.xlsx",
    makeXlsx("Labour", [
      ["Name", "Trade", "Days", "Rate (Rs)", "Amount (Rs)"],
      ["Pahalad", "Mason", 5, 900, 4500],
      ["Musha Behera", "Site worker / cook", 5, 500, 2500],
      ["Rabindra Ku Nayak", "Painter", 5, 850, 4250],
    ]),
    "labour, register",
  );
  await upload(
    sh.projectId,
    sh.siteId,
    "Inspection and quality",
    "Condition survey of 10 tanks",
    "sample-oht-condition-survey.xlsx",
    makeXlsx("Survey", [
      ["Tank", "Coating", "Cracks", "Ladder", "Valves", "Priority"],
      ...Array.from({ length: 10 }, (_, index) => [
        `OHT-${String(index + 1).padStart(2, "0")}`,
        index % 3 === 0 ? "Failed" : "Poor",
        index % 4 === 0 ? "Hairline" : "None",
        index % 2 === 0 ? "Rusted" : "Fair",
        index % 5 === 0 ? "Passing" : "Fair",
        index < 5 ? "High" : "Normal",
      ]),
    ]),
    "survey, oht",
  );
  await upload(
    sh.projectId,
    sh.siteId,
    "Measurements",
    "Paint used per tank",
    "sample-paint-per-tank.xlsx",
    makeXlsx("Paint", [
      ["Tank", "Epoxy inside (litre)", "Weather coat outside (litre)", "Enamel (litre)"],
      ["OHT-01", 43, 38, 4],
      ["OHT-02", 42, 37, 4],
      ["OHT-03", 43, 39, 5],
    ]),
    "paint, consumption",
  );
  await upload(
    sh.projectId,
    sh.siteId,
    "Inspection and quality",
    "Water quality after filling",
    "sample-water-quality.xlsx",
    makeXlsx("Water", [
      ["Tank", "Date", "Chlorine (ppm)", "Turbidity (NTU)", "pH", "Result"],
      ["OHT-01", "after filling", 0.5, 1, 7.2, "OK"],
      ["OHT-02", "after filling", 0.6, 1.2, 7.1, "OK"],
      ["OHT-03", "after filling", 0.5, 0.9, 7.3, "OK"],
    ]),
    "water quality",
  );

  // A PDF method statement.
  await upload(
    sh.projectId,
    sh.siteId,
    "Safety",
    "Method statement: tank repainting",
    "sample-method-statement.pdf",
    Buffer.from(
      simplePdf("SAMPLE METHOD STATEMENT - Overhead tank repainting", [
        "1. Inform the village committee; arrange water from another source.",
        "2. Drain the tank; ventilate for 2 hours; gas-free check before entry.",
        "3. Pressure wash, scrape loose coating, repair cracks with polymer mortar.",
        "4. Two coats of food-grade epoxy inside; 7 days curing.",
        "5. Outside: scrape, primer, two coats of weather coat.",
        "6. Fill, chlorinate, test water; hand back with the test report.",
        "Height work: harness on lifeline at all times; tools tied.",
      ]),
      "latin1",
    ),
    "method statement, safety",
  );
}

/** SAMPLE: warranty cards for both projects, with one claim. */
export async function addSampleWarranties(
  boss: SeedCaller,
  ids: Ids,
  vendorsBySite: Record<string, { id: string; legalName: string }[]>,
  today: string,
) {
  const vendor = (siteId: string, name: string) =>
    vendorsBySite[siteId]?.find((row) => row.legalName === name)?.id ?? null;
  const back = (days: number) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  };
  const plusYears = (start: string, years: number) => {
    const date = new Date(`${start}T12:00:00Z`);
    date.setUTCFullYear(date.getUTCFullYear() + years);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  };
  const k = ids.kalyan.siteId;
  const handover = back(1);
  const cards = [
    {
      siteId: k,
      direction: "Received" as const,
      itemName: "UPVC doors and windows (32 nos)",
      category: "Doors and windows" as const,
      vendorId: vendor(k, "Rajdhani UPVC"),
      reference: "SAMPLE-RU-0118",
      startDate: handover,
      endDate: plusYears(handover, 10),
      terms:
        "Profile and hardware against warping, discolouring and fittings failure; glass breakage not covered.",
    },
    {
      siteId: k,
      direction: "Received" as const,
      itemName: "Submersible pump 1.5 HP with starter panel",
      category: "Equipment" as const,
      vendorId: vendor(k, "Bhagabati Enterprises"),
      reference: "SAMPLE-BE-0477",
      startDate: handover,
      endDate: plusYears(handover, 2),
      terms: "Motor and pump end; burnt winding from low voltage not covered.",
    },
    {
      siteId: k,
      direction: "Received" as const,
      itemName: "FR copper wiring and switchgear",
      category: "Electrical" as const,
      vendorId: vendor(k, "Bhagabati Enterprises"),
      reference: "SAMPLE-BE-0451",
      startDate: back(40),
      endDate: plusYears(back(40), 1),
      terms: "Manufacturing defects in wire and MCBs.",
    },
    {
      siteId: k,
      direction: "Given" as const,
      itemName: "Defect liability: Kalyan Mandap building",
      category: "Defect liability" as const,
      partyName: "Block Development Office, Aska (Sample)",
      startDate: handover,
      endDate: plusYears(handover, 1),
      terms:
        "Contractor repairs any defect in the work at own cost for 12 months from handover; 5% retention held till then.",
    },
    ...ids.sheragada.siteIds.slice(0, 3).map((siteId, index) => ({
      siteId,
      direction: "Given" as const,
      itemName: `Inside epoxy coating, OHT-0${index + 1}`,
      category: "Painting and coating" as const,
      partyName: "RWS & S Division, Berhampur",
      startDate: back(20 - index * 3),
      endDate: plusYears(back(20 - index * 3), 3),
      terms: "Coating peeling or blistering repaired free for 3 years.",
    })),
    {
      siteId: ids.sheragada.siteIds[0]!,
      direction: "Received" as const,
      itemName: "Sluice valves 100 mm (12 nos)",
      category: "Plumbing" as const,
      vendorId: vendor(ids.sheragada.siteIds[0]!, "Bhagabati Enterprises"),
      reference: "SAMPLE-BE-DC-301",
      startDate: back(24),
      endDate: back(24 - 30),
      terms: "Gland leak and spindle failure. Short warranty: ends soon, to show the reminder.",
    },
  ];
  let pump = "";
  for (const card of cards) {
    const made = await boss.jp.warranties.create({ ...card, clientMutationId: id() });
    if (card.itemName.startsWith("Submersible")) pump = made.id;
  }
  const claim = await boss.jp.warranties.addClaim({
    warrantyId: pump,
    claimDate: today,
    problem: "SAMPLE · Starter trips after 10 minutes of running.",
  });
  await boss.jp.warranties.resolveClaim({
    claimId: claim.id,
    status: "Resolved",
    resolution: "Overload relay set right by Bhagabati's electrician.",
  });
}
