import type { Language } from "@/lib/i18n";
import { attendanceSign, type AttendanceMark } from "./worker-app";

/**
 * What the worker screen says aloud, in the worker's language: short sentences with whole
 * rupees ("12345 रुपये", not "₹12,345.00") so a speech engine reads them naturally.
 */

export const SPEECH_LANGUAGE: Record<Language, "en-IN" | "hi-IN" | "od-IN"> = {
  en: "en-IN",
  hi: "hi-IN",
  or: "od-IN",
};

/** Device speech engines use "or-IN" for Odia. */
export const DEVICE_SPEECH_LANGUAGE: Record<Language, string> = {
  en: "en-IN",
  hi: "hi-IN",
  or: "or-IN",
};

const RUPEES: Record<Language, string> = { en: "rupees", hi: "रुपये", or: "ଟଙ୍କା" };

/** Whole rupees from paise, rounded down, with the word for rupees. */
export function spokenRupees(minor: string | bigint, language: Language) {
  const value = typeof minor === "bigint" ? minor : BigInt(minor);
  const rupees = (value < 0n ? -value : value) / 100n;
  return `${value < 0n ? "-" : ""}${rupees.toString()} ${RUPEES[language]}`;
}

export type MoneyRow = { dueMinor: string; paidMinor: string; advanceOutstandingMinor: string };

export function moneySpeech(name: string, rows: readonly MoneyRow[], language: Language) {
  const sum = (pick: (row: MoneyRow) => string) =>
    rows.reduce((total, row) => total + BigInt(pick(row)), 0n);
  const due = spokenRupees(
    sum((row) => row.dueMinor),
    language,
  );
  const paid = spokenRupees(
    sum((row) => row.paidMinor),
    language,
  );
  const advance = sum((row) => row.advanceOutstandingMinor);
  const adv = spokenRupees(advance, language);
  if (language === "hi")
    return `${name}। आपको अभी ${due} मिलने हैं। ${paid} मिल चुके हैं।${advance > 0n ? ` ${adv} एडवांस लौटाना है।` : ""}`;
  if (language === "or")
    return `${name}। ଆପଣଙ୍କୁ ଏବେ ${due} ପାଇବାକୁ ଅଛି। ${paid} ପାଇସାରିଛନ୍ତି।${advance > 0n ? ` ${adv} ଅଗ୍ରିମ ଫେରାଇବାକୁ ଅଛି।` : ""}`;
  return `${name}. You still have to get ${due}. You already got ${paid}.${advance > 0n ? ` Advance to return: ${adv}.` : ""}`;
}

export function attendanceCounts(rows: readonly AttendanceMark[]) {
  const counts = { full: 0, half: 0, absent: 0, leave: 0, pending: 0 };
  for (const row of rows) {
    if (!row.approved) counts.pending += 1;
    const sign = attendanceSign(row);
    if (sign === "✓") counts.full += 1;
    else if (sign === "½") counts.half += 1;
    else if (sign === "L") counts.leave += 1;
    else counts.absent += 1;
  }
  return counts;
}

export function attendanceSpeech(rows: readonly AttendanceMark[], language: Language) {
  if (!rows.length)
    return language === "hi"
      ? "अभी कोई हाज़िरी नहीं।"
      : language === "or"
        ? "ଏପର୍ଯ୍ୟନ୍ତ ହାଜିରା ନାହିଁ।"
        : "No attendance yet.";
  const c = attendanceCounts(rows);
  if (language === "hi")
    return `पिछले दिनों में ${c.full} पूरे दिन, ${c.half} आधे दिन, ${c.absent} दिन ग़ैरहाज़िर।${c.leave ? ` ${c.leave} दिन छुट्टी।` : ""}${c.pending ? ` ${c.pending} दिन अभी जाँचे नहीं गए।` : ""}`;
  if (language === "or")
    return `ଗତ ଦିନଗୁଡ଼ିକରେ ${c.full} ପୂରା ଦିନ, ${c.half} ଅଧା ଦିନ, ${c.absent} ଦିନ ଗରହାଜର।${c.leave ? ` ${c.leave} ଦିନ ଛୁଟି।` : ""}${c.pending ? ` ${c.pending} ଦିନ ଏପର୍ଯ୍ୟନ୍ତ ଯାଞ୍ଚ ହୋଇନାହିଁ।` : ""}`;
  return `In the last days: ${c.full} full days, ${c.half} half days, ${c.absent} days absent.${c.leave ? ` ${c.leave} days leave.` : ""}${c.pending ? ` ${c.pending} days not checked yet.` : ""}`;
}

export function drawingsSpeech(titles: readonly string[], language: Language) {
  if (!titles.length)
    return language === "hi"
      ? "अभी कोई ड्रॉइंग नहीं।"
      : language === "or"
        ? "ଏପର୍ଯ୍ୟନ୍ତ କୌଣସି ଡ୍ରଇଂ ନାହିଁ।"
        : "No drawings shared yet.";
  const list = titles.slice(0, 5).join(", ");
  if (language === "hi") return `${titles.length} ड्रॉइंग हैं: ${list}। खोलने के लिए दबाएँ।`;
  if (language === "or") return `${titles.length}ଟି ଡ୍ରଇଂ ଅଛି: ${list}। ଖୋଲିବାକୁ ଦବାନ୍ତୁ।`;
  return `${titles.length} drawings: ${list}. Tap one to open it.`;
}
