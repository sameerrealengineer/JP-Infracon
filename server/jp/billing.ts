import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, like, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditEvents,
  clientBillLines,
  clientBills,
  clientReceipts,
  contractItems,
  crmClients,
  projectContracts,
  projects,
  quotationLines,
  quotations,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import {
  ageingBucket,
  billPaymentState,
  billTotals,
  checkCumulativeQuantity,
  checkReceipt,
  lineAmountMinor,
  nextNumber,
  parsePercentBps,
  parseQuantity,
} from "../../lib/jp/billing-domain";
import { parseRupeesToMinor } from "../../lib/jp/finance-domain";
import {
  commercialAccess,
  requireProject,
  type CommercialAccess,
  type Db,
} from "./commercial-access";

/**
 * Client billing: a project's client contract and contract items (client BOQ), running-account
 * (RA) bills with GST, retention and TDS, maker-checker approval, money received, and what each
 * client still owes. The server computes every amount and status; receipts are internal ledger
 * records, never a bank transfer.
 */

const uuid = z.string().uuid();
const mutationId = z.string().trim().min(16).max(64);
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.");
const today = () => new Date().toISOString().slice(0, 10);

function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}
function percent(value: string, label: string) {
  const bps = parsePercentBps(value);
  if (bps === null) bad(`${label}: enter a percentage like 18 or 2.5.`);
  return bps;
}
function rupees(value: string, label: string, allowZero = false) {
  try {
    return parseRupeesToMinor(value, allowZero);
  } catch {
    bad(`${label}: enter an amount in rupees, like 125000 or 1250.50.`);
  }
}

async function audit(
  db: Db,
  args: {
    organizationId: string;
    userId: number;
    action: string;
    entityType: string;
    entityId: string;
    clientMutationId?: string;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
  },
) {
  await db.insert(auditEvents).values({
    id: randomUUID(),
    organizationId: args.organizationId,
    actorUserId: args.userId,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    clientMutationId: args.clientMutationId ?? null,
    beforeSummary: args.before === undefined ? null : JSON.stringify(args.before),
    afterSummary: args.after === undefined ? null : JSON.stringify(args.after),
    reason: args.reason ?? null,
  });
}

async function replayed(db: Db, userId: number, clientMutationId: string) {
  const [event] = await db
    .select({ entityId: auditEvents.entityId })
    .from(auditEvents)
    .where(
      and(eq(auditEvents.actorUserId, userId), eq(auditEvents.clientMutationId, clientMutationId)),
    )
    .limit(1);
  return event ?? null;
}

async function loadProject(access: CommercialAccess, projectId: string) {
  requireProject(access, projectId);
  const [project] = await access.db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.organizationId !== access.organizationId)
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
  return project;
}

/** Quantity already billed per contract item on Submitted or Approved bills (optionally minus one). */
async function billedToDate(db: Db, projectId: string, exceptBillId?: string) {
  const rows = await db
    .select({
      itemId: clientBillLines.contractItemId,
      quantity: clientBillLines.quantityThousandths,
    })
    .from(clientBillLines)
    .innerJoin(clientBills, eq(clientBillLines.billId, clientBills.id))
    .where(
      and(
        eq(clientBills.projectId, projectId),
        inArray(clientBills.status, ["Draft", "Submitted", "Approved"]),
        exceptBillId ? ne(clientBills.id, exceptBillId) : undefined,
      ),
    );
  const map = new Map<string, bigint>();
  for (const row of rows)
    if (row.itemId) map.set(row.itemId, (map.get(row.itemId) ?? 0n) + BigInt(row.quantity));
  return map;
}

/** Money received per bill (recorded receipts only). */
async function receivedByBill(db: Db, billIds: string[]) {
  if (!billIds.length) return new Map<string, bigint>();
  const rows = await db
    .select({ billId: clientReceipts.billId, amount: clientReceipts.amountMinor })
    .from(clientReceipts)
    .where(and(inArray(clientReceipts.billId, billIds), eq(clientReceipts.status, "Recorded")));
  const map = new Map<string, bigint>();
  for (const row of rows) map.set(row.billId, (map.get(row.billId) ?? 0n) + BigInt(row.amount));
  return map;
}

const contractRouter = router({
  /** The project's contract, its items with quantity billed so far, and the client. */
  get: protectedProcedure.input(z.object({ projectId: uuid })).query(async ({ ctx, input }) => {
    const access = await commercialAccess(ctx.user, "billing.view");
    const project = await loadProject(access, input.projectId);
    const [contract] = await access.db
      .select({ contract: projectContracts, clientName: crmClients.name })
      .from(projectContracts)
      .innerJoin(crmClients, eq(projectContracts.clientId, crmClients.id))
      .where(eq(projectContracts.projectId, project.id))
      .limit(1);
    const items = await access.db
      .select()
      .from(contractItems)
      .where(and(eq(contractItems.projectId, project.id), eq(contractItems.status, "Active")))
      .orderBy(asc(contractItems.itemCode));
    const billed = await billedToDate(access.db, project.id);
    const contractValue = items.reduce(
      (sum, item) =>
        sum + lineAmountMinor(BigInt(item.contractQuantityThousandths), BigInt(item.rateMinor)),
      0n,
    );
    return {
      project: { id: project.id, name: project.name },
      contract: contract ? { ...contract.contract, clientName: contract.clientName } : null,
      contractValueMinor: contractValue.toString(),
      items: items.map((item) => {
        const done = billed.get(item.id) ?? 0n;
        return {
          ...item,
          billedThousandths: done.toString(),
          balanceThousandths: (BigInt(item.contractQuantityThousandths) - done).toString(),
        };
      }),
      canEdit: access.can("billing.create"),
    };
  }),

  /** Sets who the client is and the default GST, retention and TDS for the project's bills. */
  save: protectedProcedure
    .input(
      z.object({
        projectId: uuid,
        clientId: uuid,
        contractNumber: z.string().trim().max(80).nullish(),
        gstPercent: z.string().trim().max(6),
        retentionPercent: z.string().trim().max(6),
        tdsPercent: z.string().trim().max(6),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "billing.create");
      const project = await loadProject(access, input.projectId);
      const [client] = await access.db
        .select({ organizationId: crmClients.organizationId })
        .from(crmClients)
        .where(eq(crmClients.id, input.clientId));
      if (client?.organizationId !== access.organizationId) bad("Client not found.");
      const values = {
        clientId: input.clientId,
        contractNumber: input.contractNumber || null,
        gstBps: percent(input.gstPercent, "GST"),
        retentionBps: percent(input.retentionPercent, "Retention"),
        tdsBps: percent(input.tdsPercent, "TDS"),
        updatedBy: ctx.user.id,
      };
      await access.db.transaction(async (tx) => {
        await tx
          .insert(projectContracts)
          .values({ projectId: project.id, organizationId: access.organizationId, ...values })
          .onDuplicateKeyUpdate({ set: values });
        await audit(tx as unknown as Db, {
          organizationId: access.organizationId,
          userId: ctx.user.id,
          action: "billing.contract_saved",
          entityType: "project",
          entityId: project.id,
          after: {
            clientId: input.clientId,
            gstBps: values.gstBps,
            retentionBps: values.retentionBps,
          },
        });
      });
      return { ok: true };
    }),

  /** Adds contract items by hand. */
  addItems: protectedProcedure
    .input(
      z.object({
        projectId: uuid,
        items: z
          .array(
            z.object({
              itemCode: z.string().trim().min(1).max(40),
              description: z.string().trim().min(2).max(500),
              unit: z.string().trim().min(1).max(20),
              quantity: z.string().trim().max(20),
              rateRupees: z.string().trim().max(20),
            }),
          )
          .min(1)
          .max(300),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "billing.create");
      const project = await loadProject(access, input.projectId);
      if (await replayed(access.db, ctx.user.id, input.clientMutationId)) return { added: 0 };
      const codes = new Set<string>();
      const rows = input.items.map((item, index) => {
        const quantity = parseQuantity(item.quantity);
        if (quantity === null) bad(`Item ${index + 1}: quantity must be more than 0.`);
        if (codes.has(item.itemCode)) bad(`Item code ${item.itemCode} is repeated.`);
        codes.add(item.itemCode);
        return {
          id: randomUUID(),
          organizationId: access.organizationId,
          projectId: project.id,
          itemCode: item.itemCode,
          description: item.description,
          unit: item.unit,
          contractQuantityThousandths: quantity.toString(),
          rateMinor: rupees(item.rateRupees, `Item ${index + 1} rate`),
          createdBy: ctx.user.id,
        };
      });
      const existing = await access.db
        .select({ code: contractItems.itemCode })
        .from(contractItems)
        .where(eq(contractItems.projectId, project.id));
      const clash = existing.find((row) => codes.has(row.code));
      if (clash) bad(`Item code ${clash.code} already exists on this project.`);
      await access.db.transaction(async (tx) => {
        await tx.insert(contractItems).values(rows);
        await audit(tx as unknown as Db, {
          organizationId: access.organizationId,
          userId: ctx.user.id,
          action: "billing.contract_items_added",
          entityType: "project",
          entityId: project.id,
          clientMutationId: input.clientMutationId,
          after: { count: rows.length },
        });
      });
      return { added: rows.length };
    }),

  /** Copies an accepted quotation's lines in as contract items and sets the contract client. */
  fromQuotation: protectedProcedure
    .input(
      z.object({
        projectId: uuid,
        quotationId: uuid,
        retentionPercent: z.string().trim().max(6).default("5"),
        tdsPercent: z.string().trim().max(6).default("2"),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "billing.create");
      const project = await loadProject(access, input.projectId);
      if (await replayed(access.db, ctx.user.id, input.clientMutationId)) return { added: 0 };
      const [quotation] = await access.db
        .select()
        .from(quotations)
        .where(eq(quotations.id, input.quotationId))
        .limit(1);
      if (!quotation || quotation.organizationId !== access.organizationId)
        bad("Quotation not found.");
      if (quotation.status !== "Accepted") bad("Only an accepted quotation becomes the contract.");
      const [existingContract] = await access.db
        .select({ clientId: projectContracts.clientId })
        .from(projectContracts)
        .where(eq(projectContracts.projectId, project.id));
      if (existingContract && existingContract.clientId !== quotation.clientId)
        bad("This project already has a contract with another client.");
      const lines = await access.db
        .select()
        .from(quotationLines)
        .where(eq(quotationLines.quotationId, quotation.id))
        .orderBy(asc(quotationLines.lineNumber));
      const existing = await access.db
        .select({ code: contractItems.itemCode })
        .from(contractItems)
        .where(eq(contractItems.projectId, project.id));
      const taken = new Set(existing.map((row) => row.code));
      const rows = lines.map((line) => {
        let code = line.itemCode || `Q${line.lineNumber}`;
        while (taken.has(code)) code = `${code}-${quotation.quotationNumber.slice(-4)}`;
        taken.add(code);
        return {
          id: randomUUID(),
          organizationId: access.organizationId,
          projectId: project.id,
          itemCode: code,
          description: line.description,
          unit: line.unit,
          contractQuantityThousandths: line.quantityThousandths,
          rateMinor: line.rateMinor,
          createdBy: ctx.user.id,
        };
      });
      const contractValues = {
        clientId: quotation.clientId,
        quotationId: quotation.id,
        gstBps: quotation.gstBps,
        retentionBps: percent(input.retentionPercent, "Retention"),
        tdsBps: percent(input.tdsPercent, "TDS"),
        updatedBy: ctx.user.id,
      };
      await access.db.transaction(async (tx) => {
        await tx
          .insert(projectContracts)
          .values({
            projectId: project.id,
            organizationId: access.organizationId,
            contractNumber: quotation.quotationNumber,
            ...contractValues,
          })
          .onDuplicateKeyUpdate({ set: contractValues });
        if (rows.length) await tx.insert(contractItems).values(rows);
        await tx
          .update(quotations)
          .set({ projectId: project.id })
          .where(eq(quotations.id, quotation.id));
        await audit(tx as unknown as Db, {
          organizationId: access.organizationId,
          userId: ctx.user.id,
          action: "billing.contract_from_quotation",
          entityType: "project",
          entityId: project.id,
          clientMutationId: input.clientMutationId,
          after: { quotationNumber: quotation.quotationNumber, items: rows.length },
        });
      });
      return { added: rows.length };
    }),
});

const billLineInput = z.object({
  contractItemId: uuid,
  quantity: z.string().trim().max(20),
});

const billsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: uuid.nullish() }))
    .query(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "billing.view");
      const projectIds = input.projectId ? [input.projectId] : [...access.projectIds];
      if (input.projectId) requireProject(access, input.projectId);
      if (!projectIds.length) return [];
      const rows = await access.db
        .select({ bill: clientBills, clientName: crmClients.name, projectName: projects.name })
        .from(clientBills)
        .innerJoin(crmClients, eq(clientBills.clientId, crmClients.id))
        .innerJoin(projects, eq(clientBills.projectId, projects.id))
        .where(
          and(
            eq(clientBills.organizationId, access.organizationId),
            inArray(clientBills.projectId, projectIds),
          ),
        )
        .orderBy(desc(clientBills.billDate), desc(clientBills.createdAt))
        .limit(300);
      const received = await receivedByBill(
        access.db,
        rows.map((row) => row.bill.id),
      );
      return rows.map(({ bill, clientName, projectName }) => ({
        ...bill,
        clientName,
        projectName,
        ...(bill.status === "Approved"
          ? stringify(
              billPaymentState(BigInt(bill.netReceivableMinor), received.get(bill.id) ?? 0n),
            )
          : { receivedMinor: "0", outstandingMinor: "0", excessMinor: "0", paymentStatus: null }),
      }));
    }),

  detail: protectedProcedure.input(z.object({ billId: uuid })).query(async ({ ctx, input }) => {
    const access = await commercialAccess(ctx.user, "billing.view");
    const [bill] = await access.db
      .select()
      .from(clientBills)
      .where(eq(clientBills.id, input.billId))
      .limit(1);
    if (!bill || bill.organizationId !== access.organizationId)
      throw new TRPCError({ code: "NOT_FOUND", message: "Bill not found." });
    requireProject(access, bill.projectId);
    const [lines, receipts, client, project, creator] = await Promise.all([
      access.db
        .select()
        .from(clientBillLines)
        .where(eq(clientBillLines.billId, bill.id))
        .orderBy(asc(clientBillLines.lineNumber)),
      access.db
        .select({ receipt: clientReceipts, byName: users.name })
        .from(clientReceipts)
        .leftJoin(users, eq(clientReceipts.createdBy, users.id))
        .where(eq(clientReceipts.billId, bill.id))
        .orderBy(desc(clientReceipts.receivedOn)),
      access.db.select().from(crmClients).where(eq(crmClients.id, bill.clientId)),
      access.db
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, bill.projectId)),
      access.db.select({ name: users.name }).from(users).where(eq(users.id, bill.createdBy)),
    ]);
    const received = receipts
      .filter((row) => row.receipt.status === "Recorded")
      .reduce((sum, row) => sum + BigInt(row.receipt.amountMinor), 0n);
    return {
      bill,
      lines,
      receipts: receipts.map(({ receipt, byName }) => ({ ...receipt, byName })),
      client: client[0] ?? null,
      projectName: project[0]?.name ?? "",
      createdByName: creator[0]?.name ?? null,
      payment:
        bill.status === "Approved"
          ? stringify(billPaymentState(BigInt(bill.netReceivableMinor), received))
          : null,
      can: {
        submit: bill.status === "Draft" && bill.createdBy === ctx.user.id,
        review:
          bill.status === "Submitted" &&
          access.can("billing.approve") &&
          bill.createdBy !== ctx.user.id,
        receipt: bill.status === "Approved" && access.can("billing.receipt"),
        cancel: ["Draft", "Rejected"].includes(bill.status) && bill.createdBy === ctx.user.id,
      },
    };
  }),

  /** A new RA bill (Draft) against the project's contract items. */
  create: protectedProcedure
    .input(
      z.object({
        projectId: uuid,
        billDate: dateText,
        periodFrom: dateText.nullish(),
        periodTo: dateText.nullish(),
        lines: z.array(billLineInput).min(1).max(300),
        otherDeductionRupees: z.string().trim().max(20).default("0"),
        otherDeductionNote: z.string().trim().max(300).nullish(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "billing.create");
      const project = await loadProject(access, input.projectId);
      const [existing] = await access.db
        .select({ id: clientBills.id, number: clientBills.billNumber })
        .from(clientBills)
        .where(eq(clientBills.clientMutationId, input.clientMutationId))
        .limit(1);
      if (existing) return { id: existing.id, billNumber: existing.number };
      if (input.periodFrom && input.periodTo && input.periodTo < input.periodFrom)
        bad("The period end is before its start.");
      const id = randomUUID();
      let billNumber = "";
      await access.db.transaction(async (tx) => {
        const db = tx as unknown as Db;
        const [contract] = await tx
          .select()
          .from(projectContracts)
          .where(eq(projectContracts.projectId, project.id))
          .for("update");
        if (!contract) bad("Set up the client contract for this project first.");
        const items = await tx
          .select()
          .from(contractItems)
          .where(and(eq(contractItems.projectId, project.id), eq(contractItems.status, "Active")));
        const billed = await billedToDate(db, project.id);
        const seen = new Set<string>();
        const lines = input.lines.map((line, index) => {
          const item = items.find((row) => row.id === line.contractItemId);
          if (!item) bad(`Line ${index + 1}: contract item not found on this project.`);
          if (seen.has(item.id)) bad(`${item.itemCode} appears twice on this bill.`);
          seen.add(item.id);
          const quantity = parseQuantity(line.quantity);
          if (quantity === null) bad(`${item.itemCode}: quantity must be more than 0.`);
          const problem = checkCumulativeQuantity({
            description: `${item.itemCode} ${item.description}`,
            contractQuantity: BigInt(item.contractQuantityThousandths),
            previouslyBilled: billed.get(item.id) ?? 0n,
            thisBill: quantity,
          });
          if (problem) bad(problem.message);
          return { item, quantity, rate: BigInt(item.rateMinor) };
        });
        const totals = billTotals({
          lines: lines.map((line) => ({
            quantityThousandths: line.quantity,
            rateMinor: line.rate,
          })),
          gstBps: contract.gstBps,
          retentionBps: contract.retentionBps,
          tdsBps: contract.tdsBps,
          otherDeductionMinor: BigInt(rupees(input.otherDeductionRupees, "Other deduction", true)),
        });
        if (totals.netReceivableMinor < 0n) bad("Deductions are more than the bill value.");
        const prefix = `RA-${
          project.name
            .replace(/[^A-Za-z0-9]/g, "")
            .slice(0, 8)
            .toUpperCase() || "PRJ"
        }-`;
        const numbers = await tx
          .select({ number: clientBills.billNumber })
          .from(clientBills)
          .where(
            and(
              eq(clientBills.organizationId, access.organizationId),
              like(clientBills.billNumber, `${prefix}%`),
            ),
          );
        billNumber = nextNumber(
          prefix,
          numbers.map((row) => row.number),
          2,
        );
        await tx.insert(clientBills).values({
          id,
          organizationId: access.organizationId,
          projectId: project.id,
          clientId: contract.clientId,
          billNumber,
          billDate: input.billDate,
          periodFrom: input.periodFrom ?? null,
          periodTo: input.periodTo ?? null,
          gstBps: contract.gstBps,
          retentionBps: contract.retentionBps,
          tdsBps: contract.tdsBps,
          workValueMinor: totals.workValueMinor.toString(),
          gstMinor: totals.gstMinor.toString(),
          retentionMinor: totals.retentionMinor.toString(),
          tdsMinor: totals.tdsMinor.toString(),
          otherDeductionMinor: totals.otherDeductionMinor.toString(),
          otherDeductionNote: input.otherDeductionNote || null,
          netReceivableMinor: totals.netReceivableMinor.toString(),
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await tx.insert(clientBillLines).values(
          lines.map((line, index) => ({
            id: randomUUID(),
            billId: id,
            contractItemId: line.item.id,
            lineNumber: index + 1,
            description: `${line.item.itemCode} ${line.item.description}`,
            unit: line.item.unit,
            quantityThousandths: line.quantity.toString(),
            rateMinor: line.rate.toString(),
            amountMinor: lineAmountMinor(line.quantity, line.rate).toString(),
          })),
        );
        await audit(db, {
          organizationId: access.organizationId,
          userId: ctx.user.id,
          action: "billing.bill_created",
          entityType: "client_bill",
          entityId: id,
          clientMutationId: input.clientMutationId,
          after: { billNumber, netReceivableMinor: totals.netReceivableMinor.toString() },
        });
      });
      return { id, billNumber };
    }),

  /** Draft → Submitted (by its maker); Submitted → Approved/Rejected (by a different approver). */
  transition: protectedProcedure
    .input(
      z.object({
        billId: uuid,
        action: z.enum(["submit", "approve", "reject", "cancel"]),
        reason: z.string().trim().max(1000).nullish(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const key =
        input.action === "approve" || input.action === "reject"
          ? "billing.approve"
          : "billing.create";
      const access = await commercialAccess(ctx.user, key);
      if (await replayed(access.db, ctx.user.id, input.clientMutationId)) return { ok: true };
      if ((input.action === "reject" || input.action === "cancel") && !input.reason?.trim())
        bad("Give a reason.");
      await access.db.transaction(async (tx) => {
        const [bill] = await tx
          .select()
          .from(clientBills)
          .where(eq(clientBills.id, input.billId))
          .for("update");
        if (!bill || bill.organizationId !== access.organizationId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Bill not found." });
        requireProject(access, bill.projectId);
        const plan: Record<string, { from: string[]; to: string; maker: boolean }> = {
          submit: { from: ["Draft"], to: "Submitted", maker: true },
          approve: { from: ["Submitted"], to: "Approved", maker: false },
          reject: { from: ["Submitted"], to: "Rejected", maker: false },
          cancel: { from: ["Draft", "Rejected"], to: "Cancelled", maker: true },
        };
        const step = plan[input.action];
        if (!step.from.includes(bill.status))
          bad(
            `A ${bill.status} bill cannot be ${input.action === "submit" ? "submitted" : `${input.action}d`}.`,
          );
        if (step.maker && bill.createdBy !== ctx.user.id)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only the person who made the bill can do this.",
          });
        if (!step.maker && bill.createdBy === ctx.user.id)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "A different person must approve or reject this bill.",
          });
        await tx
          .update(clientBills)
          .set({
            status: step.to as typeof bill.status,
            ...(step.maker
              ? {}
              : {
                  reviewedBy: ctx.user.id,
                  reviewedAt: new Date(),
                  reviewReason: input.reason ?? null,
                }),
          })
          .where(eq(clientBills.id, bill.id));
        await audit(tx as unknown as Db, {
          organizationId: access.organizationId,
          userId: ctx.user.id,
          action: `billing.bill_${input.action}`,
          entityType: "client_bill",
          entityId: bill.id,
          clientMutationId: input.clientMutationId,
          before: { status: bill.status },
          after: { status: step.to },
          reason: input.reason ?? null,
        });
      });
      return { ok: true };
    }),
});

const receiptsRouter = router({
  /** Records money received against an approved bill; never more than is outstanding. */
  record: protectedProcedure
    .input(
      z.object({
        billId: uuid,
        amountRupees: z.string().trim().max(20),
        receivedOn: dateText,
        mode: z.enum(["Bank transfer", "Cheque", "Cash", "UPI", "Adjustment"]),
        reference: z.string().trim().max(120).nullish(),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "billing.receipt");
      const [existing] = await access.db
        .select({ id: clientReceipts.id })
        .from(clientReceipts)
        .where(eq(clientReceipts.clientMutationId, input.clientMutationId))
        .limit(1);
      if (existing) return { id: existing.id };
      if (input.receivedOn > today()) bad("The received date cannot be in the future.");
      const amount = BigInt(rupees(input.amountRupees, "Amount"));
      const id = randomUUID();
      await access.db.transaction(async (tx) => {
        const [bill] = await tx
          .select()
          .from(clientBills)
          .where(eq(clientBills.id, input.billId))
          .for("update");
        if (!bill || bill.organizationId !== access.organizationId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Bill not found." });
        requireProject(access, bill.projectId);
        if (bill.status !== "Approved") bad("Money can be recorded only against an approved bill.");
        const received = (await receivedByBill(tx as unknown as Db, [bill.id])).get(bill.id) ?? 0n;
        const state = billPaymentState(BigInt(bill.netReceivableMinor), received);
        const problem = checkReceipt(amount, state.outstandingMinor);
        if (problem) bad(problem.message);
        await tx.insert(clientReceipts).values({
          id,
          organizationId: access.organizationId,
          billId: bill.id,
          amountMinor: amount.toString(),
          receivedOn: input.receivedOn,
          mode: input.mode,
          reference: input.reference || null,
          clientMutationId: input.clientMutationId,
          createdBy: ctx.user.id,
        });
        await audit(tx as unknown as Db, {
          organizationId: access.organizationId,
          userId: ctx.user.id,
          action: "billing.receipt_recorded",
          entityType: "client_bill",
          entityId: bill.id,
          clientMutationId: input.clientMutationId,
          after: { amountMinor: amount.toString(), mode: input.mode },
        });
      });
      return { id };
    }),

  reverse: protectedProcedure
    .input(
      z.object({
        receiptId: uuid,
        reason: z.string().trim().min(3).max(1000),
        clientMutationId: mutationId,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await commercialAccess(ctx.user, "billing.receipt");
      if (await replayed(access.db, ctx.user.id, input.clientMutationId)) return { ok: true };
      await access.db.transaction(async (tx) => {
        const [receipt] = await tx
          .select()
          .from(clientReceipts)
          .where(eq(clientReceipts.id, input.receiptId))
          .for("update");
        if (!receipt || receipt.organizationId !== access.organizationId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Receipt not found." });
        if (receipt.status === "Reversed") bad("This receipt is already reversed.");
        await tx
          .update(clientReceipts)
          .set({ status: "Reversed", reversalReason: input.reason })
          .where(eq(clientReceipts.id, receipt.id));
        await audit(tx as unknown as Db, {
          organizationId: access.organizationId,
          userId: ctx.user.id,
          action: "billing.receipt_reversed",
          entityType: "client_bill",
          entityId: receipt.billId,
          clientMutationId: input.clientMutationId,
          before: { amountMinor: receipt.amountMinor },
          reason: input.reason,
        });
      });
      return { ok: true };
    }),
});

function stringify(state: ReturnType<typeof billPaymentState>) {
  return {
    receivedMinor: state.receivedMinor.toString(),
    outstandingMinor: state.outstandingMinor.toString(),
    excessMinor: state.excessMinor.toString(),
    paymentStatus: state.paymentStatus,
  };
}

/** What every client owes on approved bills, by age, plus retention held back. */
const receivables = protectedProcedure.query(async ({ ctx }) => {
  const access = await commercialAccess(ctx.user, "billing.view");
  const projectIds = [...access.projectIds];
  if (!projectIds.length)
    return {
      totals: { billedMinor: "0", receivedMinor: "0", outstandingMinor: "0", retentionMinor: "0" },
      clients: [],
    };
  const bills = await access.db
    .select({ bill: clientBills, clientName: crmClients.name })
    .from(clientBills)
    .innerJoin(crmClients, eq(clientBills.clientId, crmClients.id))
    .where(
      and(
        eq(clientBills.organizationId, access.organizationId),
        eq(clientBills.status, "Approved"),
        inArray(clientBills.projectId, projectIds),
      ),
    );
  const received = await receivedByBill(
    access.db,
    bills.map((row) => row.bill.id),
  );
  const now = today();
  const byClient = new Map<
    string,
    {
      clientId: string;
      clientName: string;
      billedMinor: bigint;
      receivedMinor: bigint;
      outstandingMinor: bigint;
      retentionMinor: bigint;
      ageing: Record<string, bigint>;
    }
  >();
  for (const { bill, clientName } of bills) {
    const entry = byClient.get(bill.clientId) ?? {
      clientId: bill.clientId,
      clientName,
      billedMinor: 0n,
      receivedMinor: 0n,
      outstandingMinor: 0n,
      retentionMinor: 0n,
      ageing: {},
    };
    const got = received.get(bill.id) ?? 0n;
    const state = billPaymentState(BigInt(bill.netReceivableMinor), got);
    entry.billedMinor += BigInt(bill.netReceivableMinor);
    entry.receivedMinor += got;
    entry.outstandingMinor += state.outstandingMinor;
    entry.retentionMinor += BigInt(bill.retentionMinor);
    if (state.outstandingMinor > 0n) {
      const bucket = ageingBucket(String(bill.billDate), now);
      entry.ageing[bucket] = (entry.ageing[bucket] ?? 0n) + state.outstandingMinor;
    }
    byClient.set(bill.clientId, entry);
  }
  const clients = [...byClient.values()]
    .sort((a, b) => (b.outstandingMinor > a.outstandingMinor ? 1 : -1))
    .map((row) => ({
      clientId: row.clientId,
      clientName: row.clientName,
      billedMinor: row.billedMinor.toString(),
      receivedMinor: row.receivedMinor.toString(),
      outstandingMinor: row.outstandingMinor.toString(),
      retentionMinor: row.retentionMinor.toString(),
      ageing: Object.fromEntries(Object.entries(row.ageing).map(([k, v]) => [k, v.toString()])),
    }));
  const sum = (key: "billedMinor" | "receivedMinor" | "outstandingMinor" | "retentionMinor") =>
    [...byClient.values()].reduce((total, row) => total + row[key], 0n).toString();
  return {
    totals: {
      billedMinor: sum("billedMinor"),
      receivedMinor: sum("receivedMinor"),
      outstandingMinor: sum("outstandingMinor"),
      retentionMinor: sum("retentionMinor"),
    },
    clients,
  };
});

/** Projects the caller can bill, with whether a contract is set up. */
const projectsForBilling = protectedProcedure.query(async ({ ctx }) => {
  const access = await commercialAccess(ctx.user, "billing.view");
  if (!access.projectIds.size)
    return { projects: [], can: { create: false, approve: false, receipt: false } };
  const rows = await access.db
    .select({ id: projects.id, name: projects.name, clientId: projectContracts.clientId })
    .from(projects)
    .leftJoin(projectContracts, eq(projectContracts.projectId, projects.id))
    .where(inArray(projects.id, [...access.projectIds]))
    .orderBy(asc(projects.name));
  return {
    projects: rows.map((row) => ({
      id: row.id,
      name: row.name,
      hasContract: Boolean(row.clientId),
    })),
    can: {
      create: access.can("billing.create"),
      approve: access.can("billing.approve"),
      receipt: access.can("billing.receipt"),
    },
  };
});

export const billingRouter = router({
  projects: projectsForBilling,
  contract: contractRouter,
  bills: billsRouter,
  receipts: receiptsRouter,
  receivables,
});
