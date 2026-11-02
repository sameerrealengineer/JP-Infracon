import { describe, expect, it } from "vitest";
import { formatBytes, safeFileName, sniffContentType } from "./attachment-policy";

describe("sniffContentType", () => {
  it("recognises the allowed signatures", () => {
    expect(sniffContentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffContentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png",
    );
    expect(sniffContentType(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp");
    expect(sniffContentType(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
  });
  it("rejects anything else, including a renamed script", () => {
    expect(sniffContentType(new TextEncoder().encode("<script>alert(1)</script>"))).toBeNull();
    expect(sniffContentType(new Uint8Array([]))).toBeNull();
  });
});

describe("safeFileName and formatBytes", () => {
  it("drops paths and forces the real extension", () => {
    expect(safeFileName("../../etc/passwd.exe", "image/jpeg")).toBe("passwd.jpg");
    expect(safeFileName("Site photo (1).PNG", "image/png")).toBe("Site photo _1_.png");
    expect(safeFileName("", "application/pdf")).toBe("evidence.pdf");
  });
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
