import { prisma, type Asset } from "@cheqpay/db";
import { fromMinorUnits } from "./money";
import { ensureActivitySchema } from "./activity";
import { stateLocation } from "./geo/ngStates";

/**
 * Data for the admin "Live map": where users are, who is active right now,
 * and transactions as they happen.
 *
 * Everything here is aggregated or anonymous on purpose. People are grouped
 * into grid cells (about 11 km), and transactions carry an id and an
 * approximate city — never a name, email or exact location. An admin who
 * needs to know who is behind a transaction opens it in the transactions page,
 * where access is already controlled and logged.
 */

/** Seen within this long counts as "active now" (activity is recorded at most every 5 min). */
export const ACTIVE_WINDOW_MIN = 15;
/** Furthest back a feed request may reach. */
const MAX_FEED_MS = 60 * 60_000;
const FEED_LIMIT = 100;

export interface MapCell {
  lat: number;
  lon: number;
  city: string | null;
  country: string | null;
  users: number;
  active: number;
  /** "ip": from the user's own requests; "kyc": from the state on their KYC address. */
  source: "ip" | "kyc";
}

export interface FeedTx {
  id: string;
  kind: string;
  label: string;
  amount: string;
  asset: string;
  status: string;
  at: string;
  lat: number | null;
  lon: number | null;
  city: string | null;
  country: string | null;
}

const LABELS: Record<string, [kind: string, label: string]> = {
  DEPOSIT: ["in", "Deposit"],
  TRANSFER_IN: ["in", "Received"],
  WITHDRAWAL: ["out", "Withdrawal"],
  TRANSFER_OUT: ["out", "Transfer"],
  BUY: ["trade", "Bought crypto"],
  SELL: ["trade", "Sold crypto"],
  CONVERT: ["trade", "Swap"],
  BILL: ["bill", "Bill payment"],
  CASHBACK: ["in", "Cashback"],
  CARD_FUND: ["card", "Card top-up"],
  CARD_WITHDRAW: ["card", "Card withdrawal"],
  CARD_ISSUE: ["card", "New card"],
  GADGET_PURCHASE: ["shop", "Gadget order"],
  TICKET_PURCHASE: ["shop", "Event ticket"],
  GIFTCARD_SELL: ["trade", "Gift card sale"],
  GIFTCARD_BUY: ["shop", "Gift card"],
  REFERRAL_REWARD: ["in", "Referral reward"],
  AD_PURCHASE: ["shop", "Ad campaign"],
  AD_REFUND: ["in", "Ad refund"],
  AD_PAYOUT: ["out", "Venue payout"],
  DEV_WALLET_FUND: ["out", "API wallet top-up"],
  DEV_WALLET_WITHDRAW: ["in", "API wallet withdrawal"],
};

export function txLabel(type: string): { kind: string; label: string } {
  const hit = LABELS[type];
  return hit ? { kind: hit[0], label: hit[1] } : { kind: "other", label: type.replace(/_/g, " ").toLowerCase() };
}

/** Where a user goes on the map: their own located requests first, else their KYC state. */
export function placeUser(row: {
  geo_lat: number | null;
  geo_lon: number | null;
  geo_city: string | null;
  geo_country: string | null;
  address_state: string | null;
}): { lat: number; lon: number; city: string | null; country: string | null; source: "ip" | "kyc" } | null {
  if (row.geo_lat !== null && row.geo_lon !== null) {
    return { lat: row.geo_lat, lon: row.geo_lon, city: row.geo_city, country: row.geo_country, source: "ip" };
  }
  const s = stateLocation(row.address_state);
  return s ? { lat: s.lat, lon: s.lon, city: s.city, country: "NG", source: "kyc" } : null;
}

/** The feed's `since`: what the client sent, clamped to the last hour; 30 minutes by default. */
export function feedSince(raw: string | null, now = Date.now()): Date {
  const floor = now - MAX_FEED_MS;
  const t = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(t)) return new Date(now - 30 * 60_000);
  return new Date(Math.min(now, Math.max(floor, t)));
}

type CellRow = {
  lat: number | null;
  lon: number | null;
  city: string | null;
  country: string | null;
  users: bigint;
  active: bigint;
};
type StateRow = { address_state: string | null; users: bigint; active: bigint };

/** Users per ~11 km cell (one decimal of a degree), with how many are active now. */
export async function userCells(): Promise<MapCell[]> {
  await ensureActivitySchema();
  const [located, byState] = await Promise.all([
    prisma.$queryRaw<CellRow[]>`
      SELECT round(geo_lat::numeric, 1)::float8 AS lat,
             round(geo_lon::numeric, 1)::float8 AS lon,
             mode() WITHIN GROUP (ORDER BY geo_city) AS city,
             mode() WITHIN GROUP (ORDER BY geo_country) AS country,
             count(*) AS users,
             count(*) FILTER (WHERE last_seen_at > now() - make_interval(mins => ${ACTIVE_WINDOW_MIN}::int)) AS active
        FROM app_users
       WHERE geo_lat IS NOT NULL AND geo_lon IS NOT NULL
       GROUP BY 1, 2`,
    prisma.$queryRaw<StateRow[]>`
      SELECT address_state,
             count(*) AS users,
             count(*) FILTER (WHERE last_seen_at > now() - make_interval(mins => ${ACTIVE_WINDOW_MIN}::int)) AS active
        FROM app_users
       WHERE geo_lat IS NULL AND address_state IS NOT NULL AND address_state <> ''
       GROUP BY 1`,
  ]);

  const cells: MapCell[] = located
    .filter((r) => r.lat !== null && r.lon !== null)
    .map((r) => ({
      lat: r.lat as number,
      lon: r.lon as number,
      city: r.city,
      country: r.country,
      users: Number(r.users),
      active: Number(r.active),
      source: "ip" as const,
    }));

  // Several spellings of one state ("Lagos", "Lagos State") land on one spot.
  const kyc = new Map<string, MapCell>();
  for (const r of byState) {
    const p = stateLocation(r.address_state);
    if (!p) continue;
    const key = `${p.lat},${p.lon}`;
    const cell = kyc.get(key) ?? { lat: p.lat, lon: p.lon, city: p.city, country: "NG", users: 0, active: 0, source: "kyc" as const };
    cell.users += Number(r.users);
    cell.active += Number(r.active);
    kyc.set(key, cell);
  }
  return [...cells, ...kyc.values()];
}

type TxRow = {
  id: string;
  type: string;
  asset: Asset;
  amount: bigint;
  status: string;
  created_at: Date;
  geo_lat: number | null;
  geo_lon: number | null;
  geo_city: string | null;
  geo_country: string | null;
  address_state: string | null;
};

/** Transactions since `since`, newest first, placed where their user is. */
export async function transactionFeed(since: Date): Promise<FeedTx[]> {
  await ensureActivitySchema();
  const rows = await prisma.$queryRaw<TxRow[]>`
    SELECT t.id, t.type::text AS type, t.asset::text AS asset, t.amount, t.status::text AS status, t.created_at,
           u.geo_lat, u.geo_lon, u.geo_city, u.geo_country, u.address_state
      FROM ledger_transactions t
      JOIN app_users u ON u.id = t.user_id
     WHERE t.created_at > ${since}
       AND t.status IN ('PENDING', 'PROCESSING', 'COMPLETED')
     ORDER BY t.created_at DESC
     LIMIT ${FEED_LIMIT}`;
  return rows.map((r) => {
    const place = placeUser(r);
    const { kind, label } = txLabel(r.type);
    return {
      id: r.id,
      kind,
      label,
      amount: fromMinorUnits(r.amount, r.asset),
      asset: r.asset,
      status: r.status,
      at: r.created_at.toISOString(),
      lat: place?.lat ?? null,
      lon: place?.lon ?? null,
      city: place?.city ?? null,
      country: place?.country ?? null,
    };
  });
}

export interface LiveKpis {
  activeNow: number;
  usersOnMap: number;
  totalUsers: number;
  countries: number;
  txLastHour: number;
  ngnVolumeLastHour: string;
}

export async function liveKpis(cells: MapCell[]): Promise<LiveKpis> {
  const hourAgo = new Date(Date.now() - 60 * 60_000);
  const [totalUsers, activeNow, txLastHour, ngn] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { lastSeenAt: { gt: new Date(Date.now() - ACTIVE_WINDOW_MIN * 60_000) } } }),
    prisma.transaction.count({ where: { createdAt: { gt: hourAgo }, status: { in: ["PENDING", "PROCESSING", "COMPLETED"] } } }),
    prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { createdAt: { gt: hourAgo }, asset: "NGN", status: "COMPLETED" },
    }),
  ]);
  return {
    activeNow,
    usersOnMap: cells.reduce((n, c) => n + c.users, 0),
    totalUsers,
    countries: new Set(cells.map((c) => c.country).filter(Boolean)).size,
    txLastHour,
    ngnVolumeLastHour: fromMinorUnits(ngn._sum.amount ?? 0n, "NGN"),
  };
}

/** Top places by users, for the side panel. */
export function topPlaces(cells: MapCell[], by: "city" | "country", n = 6): { name: string; users: number; active: number }[] {
  const acc = new Map<string, { users: number; active: number }>();
  for (const c of cells) {
    const name = by === "city" ? c.city : c.country;
    if (!name) continue;
    const e = acc.get(name) ?? { users: 0, active: 0 };
    e.users += c.users;
    e.active += c.active;
    acc.set(name, e);
  }
  return [...acc.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.users - a.users)
    .slice(0, n);
}
