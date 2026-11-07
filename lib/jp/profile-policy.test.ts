import { describe, expect, it } from "vitest";
import { cleanProfile, formatAddress, profileCompleteness } from "./profile-policy";

const base = {
  name: "  Sameer   Swain ",
  phone: "98765 43210",
  designation: "Site Engineer",
  department: "",
  addressLine: "Plot 12, Pakalapoli",
  city: "",
  district: "Khurda",
  state: "Odisha",
  pincode: "752055",
  emergencyContact: "",
};

describe("cleanProfile", () => {
  it("trims, normalises the mobile and turns blanks into null", () => {
    expect(cleanProfile(base)).toEqual({
      name: "Sameer Swain",
      phone: "+919876543210",
      designation: "Site Engineer",
      department: null,
      addressLine: "Plot 12, Pakalapoli",
      city: null,
      district: "Khurda",
      state: "Odisha",
      pincode: "752055",
      emergencyContact: null,
    });
  });

  it("rejects a short name, a bad mobile and a bad PIN code", () => {
    expect(cleanProfile({ ...base, name: "S" })).toMatchObject({ field: "name" });
    expect(cleanProfile({ ...base, phone: "12345" })).toMatchObject({ field: "phone" });
    expect(cleanProfile({ ...base, pincode: "05205" })).toMatchObject({ field: "pincode" });
    expect(cleanProfile({ ...base, addressLine: "x".repeat(301) })).toMatchObject({
      field: "addressLine",
    });
  });
});

describe("profile helpers", () => {
  it("formats an address from the filled parts", () => {
    expect(
      formatAddress({
        addressLine: "Plot 12",
        district: "Khurda",
        state: "Odisha",
        pincode: "752055",
      }),
    ).toBe("Plot 12, Khurda, Odisha 752055");
    expect(formatAddress({})).toBeNull();
  });

  it("measures completeness", () => {
    expect(profileCompleteness({ hasPhoto: false })).toBe(0);
    expect(
      profileCompleteness({
        hasPhoto: true,
        phone: "+919876543210",
        designation: "Engineer",
        city: "Khurda",
        state: "Odisha",
        emergencyContact: "Father 9876543210",
      }),
    ).toBe(100);
  });
});
