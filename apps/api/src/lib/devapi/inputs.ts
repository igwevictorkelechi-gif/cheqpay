// apps/api/src/lib/devapi/inputs.ts
//
// The building blocks every /v1 request body is made of, so a reference, an
// amount or a metadata blob means the same thing on every endpoint.

import { z } from "zod";
import { fromPublicId, type IdKind } from "@cheqpay/devapi";
import { V1Error } from "./handler";

/** Your own id for an object, unique per mode. */
export const referenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_\-.:/]+$/, "Use letters, digits and - _ . : / only");

export const descriptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((s) => !/[\u0000-\u001f<>]/.test(s), "No control characters or angle brackets");

/**
 * Free-form key/value pairs a developer attaches to an object and gets back.
 * Capped (20 keys, 40-character keys, 500-character values) and never used for
 * any decision on our side.
 */
export const metadataSchema = z
  .record(z.string().min(1).max(40).regex(/^[A-Za-z0-9_\-.]+$/, "Metadata keys use letters, digits and - _ ."), z.string().max(500))
  .refine((m) => Object.keys(m).length <= 20, "At most 20 metadata keys");

/** An amount in minor units (kobo or cents): a positive whole number. */
export const amountSchema = z
  .number({ invalid_type_error: "Send the amount as a number in minor units (kobo or cents)" })
  .int("Amounts are whole numbers in minor units (kobo or cents)")
  .positive("Amounts must be greater than zero")
  .max(10_000_000_000_000);

export const currencySchema = z.enum(["NGN", "USD"]);

/**
 * The row id behind a public id of the expected kind. A malformed id, an id of
 * another kind and an id that isn't yours all end the same way: 404.
 */
export function resolveId(kind: IdKind, value: unknown, param: string, what: string): string {
  const id = fromPublicId(kind, value);
  if (!id) throw new V1Error(404, `No such ${what}.`, "not_found", param);
  return id;
}

/**
 * If a database error is a unique violation, the columns of the key that
 * clashed (e.g. ["account_id", "mode", "reference"]); otherwise null. Postgres
 * names the key's columns in the error detail, which is what reaches us
 * through raw queries (the constraint's own name doesn't).
 */
export function uniqueViolation(err: unknown): string[] | null {
  const e = err as { code?: string; meta?: { code?: string; message?: string }; message?: string } | null;
  const isUnique = e?.meta?.code === "23505" || e?.code === "23505" || /\b23505\b/.test(e?.message ?? "");
  if (!isUnique) return null;
  const cols = /Key \(([^)]+)\)=/.exec(`${e?.meta?.message ?? ""} ${e?.message ?? ""}`)?.[1];
  return cols ? cols.split(",").map((c) => c.trim()) : [];
}
