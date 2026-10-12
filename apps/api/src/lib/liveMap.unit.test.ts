import { describe, expect, it } from "vitest";
import { clientGeo } from "./requestContext";
import { stateLocation } from "./geo/ngStates";
import { feedSince, placeUser, topPlaces, txLabel, type MapCell } from "./liveMap";

const req = (h: Record<string, string>) => new Request("https://api.test/x", { headers: h });

describe("clientGeo", () => {
  it("reads the edge headers and rounds to about a kilometre", () => {
    const g = clientGeo(
      req({
        "x-vercel-ip-country": "ng",
        "x-vercel-ip-country-region": "LA",
        "x-vercel-ip-city": "Ikeja%20GRA",
        "x-vercel-ip-latitude": "6.601838",
        "x-vercel-ip-longitude": "3.351486",
      }),
    );
    expect(g).toEqual({ country: "NG", region: "LA", city: "Ikeja GRA", lat: 6.6, lon: 3.35 });
  });

  it("is all null without headers, and drops nonsense", () => {
    expect(clientGeo(req({}))).toEqual({ country: null, region: null, city: null, lat: null, lon: null });
    const g = clientGeo(req({ "x-vercel-ip-country": "XX", "x-vercel-ip-latitude": "95", "x-vercel-ip-longitude": "3" }));
    expect(g.country).toBeNull();
    expect(g.lat).toBeNull();
    expect(g.lon).toBeNull();
    expect(clientGeo(req({ "x-vercel-ip-latitude": "6.5" })).lat).toBeNull(); // needs both
  });
});

describe("placing users", () => {
  it("knows each state however it is written", () => {
    expect(stateLocation("Lagos")).toMatchObject({ city: "Lagos" });
    expect(stateLocation("LAGOS STATE")).toMatchObject({ city: "Lagos" });
    expect(stateLocation("FCT - Abuja")).toMatchObject({ city: "Abuja" });
    expect(stateLocation("Akwa-Ibom")).toMatchObject({ city: "Uyo" });
    expect(stateLocation("Cross River State")).toMatchObject({ city: "Calabar" });
    expect(stateLocation("Narnia")).toBeNull();
    expect(stateLocation(null)).toBeNull();
  });

  it("prefers the user's own location, then the KYC state", () => {
    const base = { geo_city: "London", geo_country: "GB", address_state: "Lagos" };
    expect(placeUser({ ...base, geo_lat: 51.5, geo_lon: -0.12 })).toMatchObject({ city: "London", source: "ip" });
    expect(placeUser({ ...base, geo_lat: null, geo_lon: null })).toMatchObject({ city: "Lagos", country: "NG", source: "kyc" });
    expect(placeUser({ ...base, geo_lat: null, geo_lon: null, address_state: null })).toBeNull();
  });
});

describe("feed window", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  it("defaults to 30 minutes and never reaches past an hour or into the future", () => {
    expect(feedSince(null, now).toISOString()).toBe("2026-10-12T11:30:00.000Z");
    expect(feedSince("garbage", now).toISOString()).toBe("2026-10-12T11:30:00.000Z");
    expect(feedSince("2026-10-11T00:00:00Z", now).toISOString()).toBe("2026-10-12T11:00:00.000Z");
    expect(feedSince("2026-10-13T00:00:00Z", now).toISOString()).toBe("2026-10-12T12:00:00.000Z");
    expect(feedSince("2026-10-12T11:59:00Z", now).toISOString()).toBe("2026-10-12T11:59:00.000Z");
  });
});

describe("labels and rankings", () => {
  it("labels every kind of transaction", () => {
    expect(txLabel("BILL")).toEqual({ kind: "bill", label: "Bill payment" });
    expect(txLabel("SOMETHING_NEW")).toEqual({ kind: "other", label: "something new" });
  });

  it("ranks places by users", () => {
    const cell = (city: string, country: string, users: number, active: number): MapCell => ({ lat: 0, lon: 0, city, country, users, active, source: "ip" });
    const cells = [cell("Lagos", "NG", 5, 2), cell("Abuja", "NG", 3, 0), cell("Lagos", "NG", 4, 1), cell("London", "GB", 1, 1)];
    expect(topPlaces(cells, "city")).toEqual([
      { name: "Lagos", users: 9, active: 3 },
      { name: "Abuja", users: 3, active: 0 },
      { name: "London", users: 1, active: 1 },
    ]);
    expect(topPlaces(cells, "country")[0]).toEqual({ name: "NG", users: 12, active: 3 });
  });
});
