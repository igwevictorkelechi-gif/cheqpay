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

/** Whether a Postgres error is a unique violation, and on which constraint/index. */
export function uniqueViolation(err: unknown): string | null {
  const e = err as { code?: string; meta?: { code?: string; message?: string }; message?: string } | null;
  const pgCode = e?.meta?.code ?? (e?.code === "23505" ? "23505" : null);
  const text = `${e?.meta?.message ?? ""} ${e?.message ?? ""}`;
  if (pgCode !== "23505" && !/duplicate key value violates unique constraint/.test(text)) return null;
  return /unique constraint "([^"]+)"/.exec(text)?.[1] ?? "unknown";
}
