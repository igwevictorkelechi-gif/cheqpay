// The API reference, read from the OpenAPI document the API itself serves.

import { openapiDocument } from "@cheqpay/devapi/openapi";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Schema = Record<string, any>;

export const doc = openapiDocument as unknown as Schema;

export interface Operation {
  id: string;
  method: string;
  path: string;
  tag: string;
  summary: string;
  description: string;
  scope: string;
  money: boolean;
  parameters: Schema[];
  body: Schema | null;
  responses: { status: string; description: string; schema: Schema | null }[];
}

const METHODS = ["get", "post", "patch", "put", "delete"];

/** Resolve a {$ref: "#/components/schemas/X"} to its schema. */
export function resolve(s: Schema | undefined | null): Schema | null {
  if (!s) return null;
  if (typeof s.$ref === "string") {
    const name = s.$ref.split("/").pop()!;
    return { ...(doc.components.schemas[name] ?? {}), __name: name };
  }
  return s;
}

export function refName(s: Schema | undefined | null): string | null {
  if (!s) return null;
  if (typeof s.$ref === "string") return s.$ref.split("/").pop()!;
  if (s.type === "object" && s.properties?.data?.items?.$ref) return `list of ${s.properties.data.items.$ref.split("/").pop()}`;
  return null;
}

export function operations(): Operation[] {
  const out: Operation[] = [];
  for (const [path, item] of Object.entries(doc.paths as Record<string, Schema>)) {
    for (const m of METHODS) {
      const op = item[m];
      if (!op) continue;
      const body = op.requestBody?.content?.["application/json"]?.schema ?? op.requestBody?.content?.["multipart/form-data"]?.schema ?? null;
      out.push({
        id: op.operationId,
        method: m.toUpperCase(),
        path,
        tag: op.tags?.[0] ?? "Other",
        summary: op.summary,
        description: op.description,
        scope: op["x-cheqpay-scope"],
        money: Boolean(op["x-cheqpay-money"]),
        parameters: op.parameters ?? [],
        body,
        responses: Object.entries(op.responses as Record<string, Schema>)
          .filter(([status]) => !["401", "403", "429"].includes(status) || status === "403" && !String(op.responses[status].description).startsWith("The key lacks"))
          .map(([status, r]) => ({ status, description: r.description, schema: r.content?.["application/json"]?.schema ?? null })),
      });
    }
  }
  return out;
}

export const TAGS: { name: string; description: string }[] = doc.tags;

/** A type label for a property: "string", "integer", "string | null", "Address", "array of string". */
export function typeLabel(s: Schema): string {
  if (!s) return "";
  if (s.$ref) return s.$ref.split("/").pop();
  if (s.const !== undefined) return JSON.stringify(s.const);
  const t = Array.isArray(s.type) ? s.type.join(" | ") : s.type;
  if (t === "array") return `array of ${s.items ? typeLabel(s.items) : "values"}`;
  return t ?? (s.properties ? "object" : "");
}

/** A sample request body for the curl example, from the schema's required fields. */
export function sample(s: Schema | null, depth = 0): unknown {
  const r = resolve(s);
  if (!r || depth > 3) return undefined;
  if (r.example !== undefined) return r.example;
  if (r.const !== undefined) return r.const;
  if (r.enum) return r.enum[0];
  const t = Array.isArray(r.type) ? r.type[0] : r.type;
  if (t === "integer" || t === "number") return 10000;
  if (t === "boolean") return true;
  if (t === "array") return [];
  if (t === "string") {
    if (r.format === "date") return "1990-04-12";
    if (r.format === "email") return "ada@example.com";
    return "…";
  }
  if (r.properties) {
    const obj: Record<string, unknown> = {};
    for (const k of r.required ?? []) obj[k] = sample(r.properties[k], depth + 1);
    return obj;
  }
  return undefined;
}
