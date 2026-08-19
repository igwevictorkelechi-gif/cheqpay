// apps/api/src/lib/maplerad/identity.ts
//
// Identity lookups. Distinct from customers.ts: this asks Maplerad who a BVN
// belongs to, and creates nothing.

import { mapleradRequest } from "./client";
import type { BvnLookup } from "./types";

/**
 * Look a BVN up in the registry and return its details.
 *
 * POST /identity/bvn
 *
 * Read-only — it opens no customer and moves no money, so it is safe to call on
 * every KYC submission. Throws MapleradError when the BVN is not found or the
 * request is refused.
 */
export async function verifyBvn(bvn: string): Promise<BvnLookup> {
  return mapleradRequest<BvnLookup>("/identity/bvn", {
    method: "POST",
    body: { bvn },
  });
}
