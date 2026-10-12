// The admin live map's queries against a real Postgres.
//
//   DEVAPI_DB_TESTS=1 DATABASE_URL=postgresql://… npx vitest run src/lib/liveMap.int.test.ts

import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@cheqpay/db";
import { ensureActivitySchema } from "./activity";
import { liveKpis, transactionFeed, userCells } from "./liveMap";

const RUN = process.env.DEVAPI_DB_TESTS === "1";

describe.skipIf(!RUN)("live map against Postgres", () => {
  // Coordinates in the open ocean, different every run, so the assertions find
  // only this run's cell (earlier runs leave their users behind).
  const LAT = Math.round((-60 + Math.floor(Math.random() * 400) / 10 + 0.03) * 100) / 100;
  const LON = Math.round((-170 + Math.floor(Math.random() * 400) / 10 + 0.01) * 100) / 100;
  const CELL_LAT = Math.round(LAT * 10) / 10;
  const CELL_LON = Math.round(LON * 10) / 10;
  const ids: { here: string; kyc: string } = { here: "", kyc: "" };
  let txId = "";

  beforeAll(async () => {
    await ensureActivitySchema();
    const tag = randomBytes(4).toString("hex");
    const here = await prisma.user.create({ data: { email: `map-a-${tag}@x.test`, lastSeenAt: new Date() } });
    const idle = await prisma.user.create({ data: { email: `map-b-${tag}@x.test`, lastSeenAt: new Date(Date.now() - 3 * 3600_000) } });
    const kyc = await prisma.user.create({ data: { email: `map-c-${tag}@x.test`, addressState: "Zamfara State" } });
    ids.here = here.id;
    ids.kyc = kyc.id;
    for (const u of [here.id, idle.id]) {
      await prisma.$executeRaw`UPDATE app_users SET geo_lat = ${LAT}, geo_lon = ${LON}, geo_city = 'Testville', geo_country = 'AU' WHERE id = ${u}::uuid`;
    }
    txId = (
      await prisma.transaction.create({
        data: { userId: here.id, type: "BILL", asset: "NGN", amount: 250000n, status: "COMPLETED", idempotencyKey: `map-${tag}` },
      })
    ).id;
  });

  it("groups located users into cells and counts the active ones", async () => {
    const cells = await userCells();
    const mine = cells.find((c) => c.lat === CELL_LAT && c.lon === CELL_LON);
    expect(mine).toMatchObject({ city: "Testville", country: "AU", users: 2, active: 1, source: "ip" });
    const zamfara = cells.find((c) => c.source === "kyc" && c.city === "Gusau");
    expect(zamfara?.users).toBeGreaterThanOrEqual(1);
    // Aggregated only: nothing that identifies a person.
    expect(JSON.stringify(cells)).not.toMatch(/@x\.test|map-/);
  });

  it("feeds new transactions with an approximate place and no personal details", async () => {
    const feed = await transactionFeed(new Date(Date.now() - 60_000));
    const tx = feed.find((t) => t.id === txId);
    expect(tx).toMatchObject({ kind: "bill", label: "Bill payment", amount: "2500.00", asset: "NGN", lat: LAT, lon: LON, city: "Testville" });
    expect(Object.keys(tx!)).not.toContain("userId");
    expect(JSON.stringify(feed)).not.toMatch(/@x\.test/);
    expect(await transactionFeed(new Date(Date.now() + 1000))).toEqual([]);
  });

  it("adds up the headline numbers", async () => {
    const k = await liveKpis(await userCells());
    expect(k.activeNow).toBeGreaterThanOrEqual(1);
    expect(k.txLastHour).toBeGreaterThanOrEqual(1);
    expect(k.countries).toBeGreaterThanOrEqual(2);
    expect(Number(k.ngnVolumeLastHour)).toBeGreaterThanOrEqual(2500);
  });
});
