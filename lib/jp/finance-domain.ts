const MAX_MINOR_AMOUNT = 999_999_999_999_999_999n;

export function parseRupeesToMinor(value: string, allowZero = false): string {
  const normalized = value.trim();
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Enter a non-negative rupee amount with no more than two decimal places.");
  }
  const [wholePart, fractionPart = ""] = normalized.split(".");
  const amount = BigInt(wholePart) * 100n + BigInt(fractionPart.padEnd(2, "0") || "0");
  if ((!allowZero && amount <= 0n) || (allowZero && amount < 0n) || amount > MAX_MINOR_AMOUNT) {
    throw new Error(allowZero ? "The amount is outside the supported range." : "The amount must be positive and within the supported range.");
  }
  return amount.toString();
}

export function normalizeMinorAmount(value: string, allowZero = false): string {
  const normalized = value.trim();
  if (!/^\d{1,18}$/.test(normalized)) throw new Error("Minor-unit amount must be an integer string.");
  const amount = BigInt(normalized);
  if ((!allowZero && amount <= 0n) || amount > MAX_MINOR_AMOUNT) {
    throw new Error("Minor-unit amount is outside the supported range.");
  }
  return amount.toString();
}

function indianGroupedInteger(value: string): string {
  if (value.length <= 3) return value;
  const lastThree = value.slice(-3);
  const preceding = value.slice(0, -3);
  const groups: string[] = [];
  for (let end = preceding.length; end > 0; end -= 2) {
    groups.unshift(preceding.slice(Math.max(0, end - 2), end));
  }
  return `${groups.join(",")},${lastThree}`;
}

export function formatMinorAsRupees(value: string | bigint): string {
  const amount = typeof value === "bigint" ? value : BigInt(normalizeMinorAmount(value, true));
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const rupees = (absolute / 100n).toString();
  const paise = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "−" : ""}₹${indianGroupedInteger(rupees)}.${paise}`;
}

export function parsePositiveQuantity(value: string): string {
  const normalized = value.trim();
  if (!/^\d{1,11}(?:\.\d{1,3})?$/.test(normalized)) {
    throw new Error("Quantity must be positive and use at most three decimal places.");
  }
  const [wholePart, fractionPart = ""] = normalized.split(".");
  const milli = BigInt(wholePart) * 1000n + BigInt(fractionPart.padEnd(3, "0") || "0");
  if (milli <= 0n) throw new Error("Quantity must be greater than zero.");
  return `${BigInt(wholePart).toString()}.${fractionPart.padEnd(3, "0")}`;
}

export type InvoiceLineAmount = { lineTotalMinor: string };

export function calculateInvoiceTotals(
  lines: readonly InvoiceLineAmount[],
  taxMinor: string,
  chargesMinor: string,
) {
  if (lines.length === 0) throw new Error("An invoice needs at least one line item.");
  const subtotal = lines.reduce((sum, line) => sum + BigInt(normalizeMinorAmount(line.lineTotalMinor)), 0n);
  const tax = BigInt(normalizeMinorAmount(taxMinor, true));
  const charges = BigInt(normalizeMinorAmount(chargesMinor, true));
  const total = subtotal + tax + charges;
  if (subtotal > MAX_MINOR_AMOUNT || total > MAX_MINOR_AMOUNT) {
    throw new Error("Invoice total is outside the supported range.");
  }
  return {
    subtotalMinor: subtotal.toString(),
    taxMinor: tax.toString(),
    chargesMinor: charges.toString(),
    totalMinor: total.toString(),
  };
}

export type PaymentAllocationInput = { invoiceId: string; amountMinor: string };

/** Invoice-linked payments must be fully allocated; supplier advances are a separate ledger type. */
export function calculatePaymentAllocationTotal(
  paymentAmountMinor: string,
  allocations: readonly PaymentAllocationInput[],
  availableBalanceByInvoice: ReadonlyMap<string, string>,
): string {
  const paymentAmount = BigInt(normalizeMinorAmount(paymentAmountMinor));
  if (allocations.length === 0 || allocations.length > 50) {
    throw new Error("Allocate this invoice-linked payment to between 1 and 50 approved invoices.");
  }
  const seen = new Set<string>();
  let total = 0n;
  for (const allocation of allocations) {
    const invoiceId = allocation.invoiceId.trim();
    if (!invoiceId || seen.has(invoiceId)) throw new Error("Each invoice can appear only once in a payment allocation.");
    seen.add(invoiceId);
    const amount = BigInt(normalizeMinorAmount(allocation.amountMinor));
    const available = availableBalanceByInvoice.get(invoiceId);
    if (available === undefined) throw new Error("Choose an approved invoice with a positive available balance.");
    const balance = BigInt(normalizeMinorAmount(available, true));
    if (balance === 0n || amount > balance) throw new Error("An allocation exceeds the invoice's available posted-payment balance.");
    total += amount;
    if (total > paymentAmount) throw new Error("Invoice allocations cannot exceed the payment amount.");
  }
  if (total !== paymentAmount) {
    throw new Error("Allocate the full payment amount; supplier advances and unallocated funds use a separate workflow.");
  }
  return total.toString();
}

export function calculateInvoicePaymentBalance(
  invoiceTotalMinor: string,
  postedAllocationMinorAmounts: readonly string[],
): { postedAllocatedMinor: string; balanceMinor: string } {
  const invoiceTotal = BigInt(normalizeMinorAmount(invoiceTotalMinor));
  const allocated = postedAllocationMinorAmounts.reduce(
    (sum, value) => sum + BigInt(normalizeMinorAmount(value)),
    0n,
  );
  if (allocated > invoiceTotal) throw new Error("Posted payment allocations exceed the approved invoice total.");
  return { postedAllocatedMinor: allocated.toString(), balanceMinor: (invoiceTotal - allocated).toString() };
}

export type PettyCashMovementForBalance = {
  movementType: "Funding" | "Expense" | "Cash Return";
  amountMinor: string;
  status: string;
};

/** Petty-cash balances include Posted entries only; drafts and approvals never change cash. */
export function calculatePettyCashBalance(movements: readonly PettyCashMovementForBalance[]) {
  let funded = 0n;
  let expenses = 0n;
  let cashReturned = 0n;
  for (const movement of movements) {
    if (movement.status !== "Posted") continue;
    const amount = BigInt(normalizeMinorAmount(movement.amountMinor));
    if (movement.movementType === "Funding") funded += amount;
    else if (movement.movementType === "Expense") expenses += amount;
    else if (movement.movementType === "Cash Return") cashReturned += amount;
    else throw new Error("Unsupported posted petty-cash movement type.");
  }
  const balance = funded + cashReturned - expenses;
  if (balance < 0n || funded + cashReturned > MAX_MINOR_AMOUNT || expenses > MAX_MINOR_AMOUNT) {
    throw new Error("Posted petty-cash movements produce an invalid balance.");
  }
  return {
    fundedMinor: funded.toString(),
    expenseMinor: expenses.toString(),
    returnedMinor: cashReturned.toString(),
    balanceMinor: balance.toString(),
  };
}

export function assertPettyCashPostingWithinLimits(args: {
  movementType: "Funding" | "Expense" | "Cash Return";
  amountMinor: string;
  balanceMinor: string;
  authorizedLimitMinor: string;
}): string {
  const amount = BigInt(normalizeMinorAmount(args.amountMinor));
  const balance = BigInt(normalizeMinorAmount(args.balanceMinor, true));
  const limit = BigInt(normalizeMinorAmount(args.authorizedLimitMinor));
  if (args.movementType === "Expense") {
    if (amount > balance) throw new Error("The expense exceeds the fund's posted available cash balance.");
    return (balance - amount).toString();
  }
  const nextBalance = balance + amount;
  if (nextBalance > limit) throw new Error("The posting would exceed this fund's authorised limit.");
  return nextBalance.toString();
}

export function calculateRemainingPettyCashReturnMinor(
  expenseAmountMinor: string,
  postedReturnMinorAmounts: readonly string[],
): string {
  const expense = BigInt(normalizeMinorAmount(expenseAmountMinor));
  const returned = postedReturnMinorAmounts.reduce(
    (sum, value) => sum + BigInt(normalizeMinorAmount(value, true)),
    0n,
  );
  if (returned > expense) throw new Error("Posted cash returns exceed the linked expense amount.");
  return (expense - returned).toString();
}
