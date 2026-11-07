import { normalizeIndianMobile } from "./notify-policy";

/** Profile details a person keeps about themselves, checked the same way on the phone and server. */

export const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;

export type ProfileInput = {
  name: string;
  phone: string;
  designation: string;
  department: string;
  addressLine: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  emergencyContact: string;
};

export type CleanProfile = {
  name: string;
  phone: string | null;
  designation: string | null;
  department: string | null;
  addressLine: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  emergencyContact: string | null;
};

const limits: Record<keyof ProfileInput, number> = {
  name: 160,
  phone: 20,
  designation: 120,
  department: 120,
  addressLine: 300,
  city: 120,
  district: 120,
  state: 120,
  pincode: 10,
  emergencyContact: 160,
};

const labels: Record<keyof ProfileInput, string> = {
  name: "Name",
  phone: "Mobile",
  designation: "Designation",
  department: "Department",
  addressLine: "Address",
  city: "City or village",
  district: "District",
  state: "State",
  pincode: "PIN code",
  emergencyContact: "Emergency contact",
};

/** Trims every field, turns blanks into null, and checks name, mobile and PIN code. */
export function cleanProfile(
  input: ProfileInput,
): CleanProfile | { field: keyof ProfileInput; message: string } {
  const out: Record<string, string | null> = {};
  for (const key of Object.keys(limits) as (keyof ProfileInput)[]) {
    const value = (input[key] ?? "").replace(/\s+/g, " ").trim();
    if (value.length > limits[key]) return { field: key, message: `${labels[key]} is too long.` };
    out[key] = value || null;
  }
  if (!out.name || out.name.length < 2) return { field: "name", message: "Enter your full name." };
  if (out.phone) {
    const phone = normalizeIndianMobile(out.phone);
    if (!phone) return { field: "phone", message: "Enter a valid 10-digit Indian mobile number." };
    out.phone = phone;
  }
  if (out.pincode && !/^[1-9]\d{5}$/.test(out.pincode))
    return { field: "pincode", message: "PIN code is 6 digits." };
  return out as CleanProfile;
}

/** "Pakalapoli, Khurda, Odisha 752055" from whichever parts are filled. */
export function formatAddress(profile: {
  addressLine?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  pincode?: string | null;
}): string | null {
  const place = [profile.addressLine, profile.city, profile.district].filter(Boolean).join(", ");
  const region = [profile.state, profile.pincode].filter(Boolean).join(" ");
  const text = [place, region].filter(Boolean).join(", ");
  return text || null;
}

/** How complete the profile is, so the app can nudge people to finish it. */
export function profileCompleteness(profile: Partial<CleanProfile> & { hasPhoto: boolean }) {
  const checks = [
    profile.hasPhoto,
    Boolean(profile.phone),
    Boolean(profile.designation),
    Boolean(profile.addressLine || profile.city),
    Boolean(profile.state),
    Boolean(profile.emergencyContact),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
