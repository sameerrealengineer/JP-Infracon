import { describe, expect, it } from "vitest";
import {
  attendanceCounts,
  attendanceSpeech,
  drawingsSpeech,
  moneySpeech,
  spokenRupees,
} from "./worker-speech";

const rows = [
  { dueMinor: "1250050", paidMinor: "800000", advanceOutstandingMinor: "200000" },
  { dueMinor: "50", paidMinor: "0", advanceOutstandingMinor: "0" },
];

describe("worker speech", () => {
  it("speaks whole rupees", () => {
    expect(spokenRupees("1234599", "hi")).toBe("12345 रुपये");
    expect(spokenRupees(0n, "or")).toBe("0 ଟଙ୍କା");
    expect(spokenRupees("-5000", "en")).toBe("-50 rupees");
  });
  it("adds up money across sites in each language", () => {
    expect(moneySpeech("Ramesh", rows, "en")).toBe(
      "Ramesh. You still have to get 12501 rupees. You already got 8000 rupees. Advance to return: 2000 rupees.",
    );
    expect(moneySpeech("रमेश", rows, "hi")).toContain("12501 रुपये मिलने हैं");
    expect(moneySpeech("Ramesh", rows, "or")).toContain("2000 ଟଙ୍କା ଅଗ୍ରିମ");
  });
  it("leaves out the advance when nothing is owed", () => {
    expect(moneySpeech("A", [rows[1]], "hi")).not.toContain("एडवांस");
  });
  it("counts attendance", () => {
    const marks = [
      { status: "Full Day", approved: true },
      { status: "Half Day", approved: true },
      { status: "Absent", approved: false },
      { status: "Leave", approved: true },
    ];
    expect(attendanceCounts(marks)).toEqual({ full: 1, half: 1, absent: 1, leave: 1, pending: 1 });
    expect(attendanceSpeech(marks, "en")).toBe(
      "In the last days: 1 full days, 1 half days, 1 days absent. 1 days leave. 1 days not checked yet.",
    );
    expect(attendanceSpeech([], "or")).toBe("ଏପର୍ଯ୍ୟନ୍ତ ହାଜିରା ନାହିଁ।");
  });
  it("lists drawings", () => {
    expect(drawingsSpeech(["GF-01"], "hi")).toBe("1 ड्रॉइंग हैं: GF-01। खोलने के लिए दबाएँ।");
  });
});
