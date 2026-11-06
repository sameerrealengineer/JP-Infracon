/**
 * The project page: client billing at a glance. Only Approved bills count as billed; drafts and
 * bills waiting for approval are counted apart so the page never shows them as money owed.
 */

export type HubBill = {
  status: string;
  netReceivableMinor: string;
  receivedMinor: string;
  outstandingMinor: string;
};

export function summarizeBills(bills: readonly HubBill[], contractValueMinor: string | null) {
  let billed = 0n;
  let received = 0n;
  let outstanding = 0n;
  let waiting = 0;
  let drafts = 0;
  for (const bill of bills) {
    if (bill.status === "Approved") {
      billed += BigInt(bill.netReceivableMinor);
      received += BigInt(bill.receivedMinor);
      outstanding += BigInt(bill.outstandingMinor);
    } else if (bill.status === "Submitted") waiting += 1;
    else if (bill.status === "Draft") drafts += 1;
  }
  const contract = contractValueMinor ? BigInt(contractValueMinor) : 0n;
  return {
    billedMinor: billed.toString(),
    receivedMinor: received.toString(),
    outstandingMinor: outstanding.toString(),
    /** Share of the contract value billed, tenths of a percent (null without a contract). */
    billedTenths: contract > 0n ? Number((billed * 1000n) / contract) : null,
    waitingForApproval: waiting,
    drafts,
  };
}
