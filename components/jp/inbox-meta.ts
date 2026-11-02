import type { IconName, Tone } from "@/components/jp/ui";
import type { InboxItem } from "@/lib/jp/site-admin-policy";

export const inboxIcon: Record<InboxItem["kind"], { icon: IconName; tone: Tone }> = {
  "report.review": { icon: "fact-check", tone: "info" },
  "report.returned": { icon: "assignment-return", tone: "error" },
  "material.review": { icon: "local-shipping", tone: "accent" },
  "invoice.review": { icon: "receipt-long", tone: "info" },
  "payment.review": { icon: "payments", tone: "accent" },
  "payment.post": { icon: "account-balance", tone: "success" },
  "inventory.review": { icon: "inventory", tone: "info" },
  "cash.review": { icon: "account-balance-wallet", tone: "accent" },
  "cash.post": { icon: "price-check", tone: "success" },
  "cash.acknowledge": { icon: "how-to-reg", tone: "warning" },
  "task.overdue": { icon: "event-busy", tone: "error" },
};
