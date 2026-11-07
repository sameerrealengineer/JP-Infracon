import { describe, expect, it } from "vitest";
import { formatReply, parseInbound, shouldSendStrangerNote } from "./whatsapp-bot";

const event = (data: Record<string, unknown>) => ({ event: "message.received", data });
const base = {
  id: "3EB0ABC",
  from: "919876543210@c.us",
  body: " Aaj kya baaki hai? ",
  type: "text",
  isGroup: false,
  kind: "individual",
  fromMe: false,
};

describe("whatsapp bot rules", () => {
  it("reads a private text message with the sender's phone", () => {
    expect(parseInbound(event(base))).toEqual({
      messageId: "3EB0ABC",
      phone: "+919876543210",
      text: "Aaj kya baaki hai?",
      type: "text",
    });
  });

  it("uses senderPhone for privacy ids", () => {
    expect(
      parseInbound(event({ ...base, from: "12345@lid", senderPhone: "919876543210" }))?.phone,
    ).toBe("+919876543210");
    expect(parseInbound(event({ ...base, from: "12345@lid" }))).toBeNull();
  });

  it("ignores own messages, groups, status, other events and junk", () => {
    expect(parseInbound(event({ ...base, fromMe: true }))).toBeNull();
    expect(parseInbound(event({ ...base, isGroup: true }))).toBeNull();
    expect(parseInbound(event({ ...base, kind: "status" }))).toBeNull();
    expect(parseInbound({ event: "message.sent", data: base })).toBeNull();
    expect(parseInbound(null)).toBeNull();
    expect(parseInbound(event({ ...base, id: undefined }))).toBeNull();
  });

  it("keeps replies plain and short, and notes strangers once a day", () => {
    expect(formatReply("## Status\n**Block A** is behind")).toBe("Status\n*Block A* is behind");
    const now = new Date("2026-11-04T10:00:00Z");
    expect(shouldSendStrangerNote(null, now)).toBe(true);
    expect(shouldSendStrangerNote(new Date("2026-11-04T01:00:00Z"), now)).toBe(false);
    expect(shouldSendStrangerNote(new Date("2026-11-03T09:00:00Z"), now)).toBe(true);
  });
});
