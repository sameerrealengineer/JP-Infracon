import { describe, expect, it } from "vitest";
import { describeDistance, distanceMeters, isValidLatLng, presencePlausible } from "./geo";

describe("geo helpers", () => {
  it("measures distance between two points", () => {
    // Bhubaneswar railway station to Kalinga Stadium, roughly 3.3 km.
    const d = distanceMeters(
      { latitude: 20.2655, longitude: 85.8433 },
      { latitude: 20.2867, longitude: 85.8216 },
    );
    expect(d).toBeGreaterThan(3000);
    expect(d).toBeLessThan(3500);
    expect(distanceMeters({ latitude: 20, longitude: 85 }, { latitude: 20, longitude: 85 })).toBe(
      0,
    );
  });
  it("validates coordinates", () => {
    expect(isValidLatLng({ latitude: 20.3, longitude: 85.8 })).toBe(true);
    expect(isValidLatLng({ latitude: 0, longitude: 0 })).toBe(false);
    expect(isValidLatLng({ latitude: 95, longitude: 10 })).toBe(false);
  });
  it("checks arrival/departure plausibility with GPS error", () => {
    expect(presencePlausible("Arrived", 180, 150, 20)).toBe(true);
    expect(presencePlausible("Arrived", 900, 150, 20)).toBe(false);
    expect(presencePlausible("Left", 100, 150, 30)).toBe(true);
    expect(presencePlausible("Left", 10, 150, 20)).toBe(false);
  });
  it("describes distance", () => {
    expect(describeDistance(50, 200)).toBe("Taken on site");
    expect(describeDistance(450, 200)).toBe("450 m from site");
    expect(describeDistance(2500, 200)).toBe("2.5 km from site");
  });
});
