import { prisma } from "@cheqpay/db";
import type { MapleradCustomerDetail } from "./maplerad/types";

/**
 * Snapshots of a Maplerad customer as GET /customers/{id} returned it.
 *
 * A dedicated raw table — reached only through the SQL here, never a Prisma
 * model — for the same reason kyc_document_files is: a jsonb blob on a modelled
 * table would be dragged into unrelated reads by Prisma's select-every-column
 * behaviour. A table Prisma does not know about cannot be selected by accident.
 *
 * Created lazily (a new table, so nothing else selects it) rather than at boot.
 */
let ensured: Promise<void> | null = null;
export function ensureMapleradSnapshotStore(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS maplerad_customer_snapshots (
          id           UUID PRIMARY KEY,
          customer_id  TEXT NOT NULL,
          tier         INTEGER,
          payload      JSONB NOT NULL,
          fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS maplerad_customer_snapshots_customer_idx
           ON maplerad_customer_snapshots (customer_id, fetched_at DESC)`,
      );
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

/**
 * Strip the two fields Maplerad's own type marks "do not store": the government
 * ID number and the document image. Everything else — name, tier evidence, dob,
 * phone, address, status — is what a snapshot is for and is kept.
 */
export function redactMapleradCustomer(detail: MapleradCustomerDetail): MapleradCustomerDetail {
  if (!detail.identity) return detail;
  const { number: _number, image: _image, ...identityRest } = detail.identity;
  return { ...detail, identity: identityRest };
}

/**
 * Persist one snapshot and return its id. The payload holds the redacted
 * customer AND its accounts (GET /customers/{id}/accounts) together — the
 * account number and bank are exactly the "details generated" worth keeping,
 * and they carry no secret to redact.
 */
export async function storeMapleradCustomerSnapshot(
  customerId: string,
  tier: number | null,
  detail: MapleradCustomerDetail,
  accounts: unknown[] = [],
): Promise<string> {
  await ensureMapleradSnapshotStore();
  const id = crypto.randomUUID();
  const payload = JSON.stringify({ customer: redactMapleradCustomer(detail), accounts });
  await prisma.$executeRaw`
    INSERT INTO maplerad_customer_snapshots (id, customer_id, tier, payload)
    VALUES (${id}::uuid, ${customerId}, ${tier}, ${payload}::jsonb)`;
  return id;
}

/** The most recent snapshot for a customer, or null if none has been taken. */
export async function latestMapleradCustomerSnapshot(
  customerId: string,
): Promise<{ tier: number | null; payload: unknown; fetchedAt: Date } | null> {
  await ensureMapleradSnapshotStore();
  const rows = await prisma.$queryRaw<
    Array<{ tier: number | null; payload: unknown; fetched_at: Date }>
  >`
    SELECT tier, payload, fetched_at FROM maplerad_customer_snapshots
    WHERE customer_id = ${customerId} ORDER BY fetched_at DESC LIMIT 1`;
  const r = rows[0];
  return r ? { tier: r.tier, payload: r.payload, fetchedAt: r.fetched_at } : null;
}
