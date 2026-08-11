import { requireAdmin } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { MapleradError } from "@/lib/maplerad/client";
import { getInstitutions } from "@/lib/maplerad/accounts";
import { getWallets } from "@/lib/maplerad/wallets";
import { getBillers } from "@/lib/maplerad/bills";
import { mapleradIfConfigured } from "@/payments";
import { BillPaymentError } from "@/payments/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin: does Maplerad actually work from *this* deployment, right now?
 *
 * Configuration status (which keys are set) is a different question, answered by
 * /api/admin/provider-status. That one reads process.env and always succeeds; it
 * cannot tell you whether the key is valid, whether this server's egress IP is
 * whitelisted, or whether collections are enabled on the business. Those only
 * come from making real calls, which is what this route does.
 *
 * Every probe is READ-ONLY — listing banks, wallets and billers. Nothing here
 * moves money, enrolls anyone, or creates an account, so it is safe to run
 * against live credentials whenever something looks wrong.
 *
 * The important failure to recognise is HTTP 403 on every probe: that is
 * Maplerad rejecting this server's IP address, not a bad key. It is the
 * expected result on Vercel, whose serverless functions have no fixed outbound
 * IP — see apps/api/GO-LIVE.md.
 */

interface ProbeResult {
  name: string;
  /** What the operator learns if this passes. */
  proves: string;
  ok: boolean;
  detail: string;
  ms: number;
}

async function probe(
  name: string,
  proves: string,
  run: () => Promise<string>,
): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const detail = await run();
    return { name, proves, ok: true, detail, ms: Date.now() - started };
  } catch (err) {
    return {
      name,
      proves,
      ok: false,
      detail: describe(err),
      ms: Date.now() - started,
    };
  }
}

/**
 * Turn a failure into something an operator can act on. The status code carries
 * most of the meaning with Maplerad, so it is named explicitly rather than left
 * inside a generic message.
 */
function describe(err: unknown): string {
  // The two Maplerad clients report failures with different error types. Map
  // the second one onto the first so a 403 reads as a 403 either way, rather
  // than falling through to a bare message with the status buried in it.
  if (err instanceof BillPaymentError) {
    return describe(
      new MapleradError(err.providerMessage ?? err.message, err.providerStatus ?? 0, err),
    );
  }
  if (err instanceof MapleradError) {
    if (err.status === 403) {
      return `HTTP 403 — Maplerad rejected this server's IP address. Whitelist the deployment's outbound IP in the Maplerad dashboard. Vercel has no fixed outbound IP, so this cannot be satisfied there. (${err.message})`;
    }
    if (err.status === 401) {
      return `HTTP 401 — the key was rejected. Check MAPLERAD_SECRET_KEY is the LIVE key and has not been rotated. (${err.message})`;
    }
    if (err.status === 0) {
      return `Could not reach Maplerad at all: ${err.message}`;
    }
    return `HTTP ${err.status} — ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const env = getEnv();

    if (!env.MAPLERAD_SECRET_KEY) {
      return jsonOk({
        configured: false,
        summary: "MAPLERAD_SECRET_KEY is not set on the API, so nothing was tried.",
        probes: [],
      });
    }

    // Sequential, not parallel: if the IP is not whitelisted every probe fails
    // identically, and four simultaneous rejections tell you nothing that one
    // does. Sequential also keeps the ordering of the report meaningful.
    const probes: ProbeResult[] = [];

    probes.push(
      await probe(
        "Reachability and credentials",
        "The key is valid AND this server's IP is whitelisted",
        async () => {
          const banks = await getInstitutions({ type: "NUBAN", pageSize: 100 });
          return `${banks.length} payout banks listed`;
        },
      ),
    );

    probes.push(
      await probe(
        "Collections enabled",
        "Users can be given a deposit account (bank transfers in)",
        async () => {
          const banks = await getInstitutions({ type: "VIRTUAL", pageSize: 100 });
          if (banks.length === 0) {
            throw new Error(
              "Maplerad returned no VIRTUAL institutions, which means collections are not enabled on this business. Deposit accounts cannot be created until Maplerad switches it on.",
            );
          }
          return `${banks.length} collection banks available`;
        },
      ),
    );

    probes.push(
      await probe(
        "Business wallets",
        "There is float to settle payouts and bills from",
        async () => {
          const wallets = await getWallets();
          if (wallets.length === 0) throw new Error("No business wallets returned");
          return wallets
            .map((w) => `${w.currency || "?"}: ${w.available_balance} available (minor units)`)
            .join(", ");
        },
      ),
    );

    probes.push(
      await probe(
        "Bill billers",
        "Data, electricity and cable can be sold",
        async () => {
          const billers = await getBillers("data");
          if (billers.length === 0) throw new Error("No data billers returned");
          return `${billers.length} data billers`;
        },
      ),
    );

    // The four probes above all run through lib/maplerad/client.ts. The money
    // paths — virtual accounts, transfers, bills — use a SECOND client in
    // payments/maplerad.ts with its own fetch, its own headers and its own copy
    // of the proxy secret. It can be broken while every probe above passes, and
    // the first person to find out would otherwise be a user whose deposit
    // account never appeared. listBanks is that client's cheapest GET.
    probes.push(
      await probe(
        "Money-path client",
        "The client behind virtual accounts, transfers and bills also authenticates",
        async () => {
          const psp = mapleradIfConfigured();
          if (!psp) throw new Error("Maplerad payment provider is not configured");
          const banks = await psp.listBanks();
          if (banks.length === 0) throw new Error("No banks returned");
          return `${banks.length} banks listed via payments/maplerad.ts`;
        },
      ),
    );

    const failed = probes.filter((p) => !p.ok);
    const allForbidden =
      failed.length === probes.length &&
      failed.every((p) => p.detail.startsWith("HTTP 403"));

    const summary = allForbidden
      ? "Every call was rejected with 403. This server's outbound IP is not whitelisted with Maplerad — the keys themselves may be fine. See apps/api/GO-LIVE.md."
      : failed.length === 0
        ? "All checks passed. Maplerad is reachable and usable from this deployment."
        : `${failed.length} of ${probes.length} checks failed.`;

    return jsonOk({
      configured: true,
      paymentProvider: env.PAYMENT_PROVIDER,
      custodyProvider: env.CUSTODY_PROVIDER,
      baseUrl: env.MAPLERAD_BASE_URL,
      webhookSecretConfigured: Boolean(process.env.MAPLERAD_WEBHOOK_SECRET),
      allPassed: failed.length === 0,
      summary,
      probes,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
