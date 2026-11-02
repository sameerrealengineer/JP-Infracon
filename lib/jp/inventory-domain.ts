export type InventoryMovementType =
  | "Receipt/Inward"
  | "Issue/Consumption"
  | "Return to Store"
  | "Wastage"
  | "Damage";
export type InventoryDirection = "Inbound" | "Outbound";

const quantityPattern = /^(\d{1,11})(?:\.(\d{1,3}))?$/;
const signedBalancePattern = /^(-?)(\d{1,11})(?:\.(\d{1,3}))?$/;
const scale = 1000n;

/** Parse a non-negative fixed-precision quantity into thousandths. */
export function parseStockQuantity(value: string, allowZero = false): bigint {
  const match = quantityPattern.exec(value.trim());
  if (!match) throw new Error("Enter a quantity with up to 11 whole digits and 3 decimal places.");
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(3, "0") || "0");
  const result = whole * scale + fraction;
  if (!allowZero && result <= 0n) throw new Error("Quantity must be greater than zero.");
  return result;
}

function parseSignedBalance(value: string): bigint {
  const match = signedBalancePattern.exec(value.trim());
  if (!match) throw new Error("The calculated stock balance has an unsupported precision.");
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? "").padEnd(3, "0") || "0");
  const result = whole * scale + fraction;
  return match[1] === "-" ? -result : result;
}

export function formatStockQuantity(value: string | bigint): string {
  const scaled = typeof value === "bigint" ? value : parseSignedBalance(value);
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const whole = (absolute / scale).toString();
  const fraction = (absolute % scale).toString().padStart(3, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function normalizeStockQuantity(value: string, allowZero = false): string {
  return formatStockQuantity(parseStockQuantity(value, allowZero));
}

export function directionForMovement(type: InventoryMovementType): InventoryDirection {
  return type === "Receipt/Inward" || type === "Return to Store" ? "Inbound" : "Outbound";
}

export function balanceAfterMovement(
  balance: string | bigint,
  quantity: string | bigint,
  direction: InventoryDirection,
): bigint {
  const current = typeof balance === "bigint" ? balance : parseSignedBalance(balance);
  const delta = typeof quantity === "bigint" ? quantity : parseStockQuantity(quantity);
  return direction === "Inbound" ? current + delta : current - delta;
}

export function canPostWithoutNegativeStock(
  balance: string | bigint,
  quantity: string | bigint,
): boolean {
  return balanceAfterMovement(balance, quantity, "Outbound") >= 0n;
}

export function calculatePostedStockBalance(
  movements: ReadonlyArray<{
    status: string;
    movementType: InventoryMovementType;
    quantity: string;
  }>,
): string {
  let balance = 0n;
  for (const movement of movements) {
    if (movement.status !== "Posted") continue;
    balance = balanceAfterMovement(
      balance,
      movement.quantity,
      directionForMovement(movement.movementType),
    );
  }
  return formatStockQuantity(balance);
}

export function isAtOrBelowReorderThreshold(balance: string, threshold: string | null): boolean {
  if (threshold === null) return false;
  return parseSignedBalance(balance) <= parseStockQuantity(threshold, true);
}
