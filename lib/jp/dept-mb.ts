/**
 * Department measurement book (MB): work measured against the contract BOQ, then signed by the
 * department's engineer (name, designation, date, MB book and page). Only signed quantities are
 * a basis for the RA bill to the department: once a project keeps its MB in the app, a bill may
 * not take an item past its signed cumulative quantity. Quantities are thousandths (BigInt).
 */

export type MbEntry = {
  contractItemId: string;
  quantityThousandths: string;
  deduction: "Yes" | "No";
  status: "Recorded" | "Signed" | "Rejected";
};

/** Net measured quantity per item (deductions subtract), only for the given statuses. */
export function netByItem(entries: readonly MbEntry[], statuses: readonly MbEntry["status"][]) {
  const map = new Map<string, bigint>();
  for (const entry of entries) {
    if (!statuses.includes(entry.status)) continue;
    const q = BigInt(entry.quantityThousandths) * (entry.deduction === "Yes" ? -1n : 1n);
    map.set(entry.contractItemId, (map.get(entry.contractItemId) ?? 0n) + q);
  }
  return map;
}

/** Per item: contract, measured (recorded + signed), signed, billed and signed balance to bill. */
export function mbAbstract(
  items: readonly { id: string; contractQuantityThousandths: string }[],
  entries: readonly MbEntry[],
  billed: ReadonlyMap<string, bigint>,
) {
  const measured = netByItem(entries, ["Recorded", "Signed"]);
  const signed = netByItem(entries, ["Signed"]);
  return items.map((item) => {
    const s = signed.get(item.id) ?? 0n;
    const b = billed.get(item.id) ?? 0n;
    return {
      itemId: item.id,
      contractThousandths: item.contractQuantityThousandths,
      measuredThousandths: (measured.get(item.id) ?? 0n).toString(),
      signedThousandths: s.toString(),
      billedThousandths: b.toString(),
      toBillThousandths: (s > b ? s - b : 0n).toString(),
    };
  });
}

/** Refusal text when a bill line goes past the signed MB quantity; null when within it. */
export function signedLimitProblem(input: {
  description: string;
  signed: bigint;
  previouslyBilled: bigint;
  thisBill: bigint;
}): string | null {
  if (input.previouslyBilled + input.thisBill <= input.signed) return null;
  const left = input.signed - input.previouslyBilled;
  return `${input.description}: only ${formatThousandths(left > 0n ? left : 0n)} more is signed in the department MB. Get the measurement signed first.`;
}

export function formatThousandths(value: bigint) {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 1000n;
  const frac = (abs % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}
