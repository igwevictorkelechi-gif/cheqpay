import { requireAdmin } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { MapleradError } from "@/lib/maplerad/client";
import { getInstitutions } from "@/lib/maplerad/accounts";
import { getWallets } from "@/lib/maplerad/wallets";
import { getBillers } from "@/lib/maplerad/bills";
import { getCard } from "@/lib/maplerad/issuing";
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
 * Every probe is READ-ONLY — listing banks, wallets and billers, and looking up
 * a non-existent card to test whether the /issuing path is reachable. Nothing
 * here moves money, enrolls anyone, or creates a card, so it is safe to run
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
 * "Unreachable" means the request never got an answer FROM Maplerad: a
 * transport failure (status 0) or a gateway error from the egress proxy in
 * front of it (502/503/504). It is distinct from Maplerad itself answering
 * with a 4xx, which — however unwelcome — proves the round trip completed.
 */
function isUnreachable(err: MapleradError): boolean {
  return err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504;
}

/** Pull the egress proxy's own words out of a failure body, if present. */
function proxyDetail(body: unknown): string | null {
  if (body && typeof body === "object") {
    const b = body as { error?: unknown; detail?: unknown; message?: unknown };
    const parts = [b.error, b.detail, b.message].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
    if (parts.length) return parts.join(" — ");
  }
  return null;
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
    if (err.status === 502 || err.status === 503 || err.status === 504) {
      // A gateway error is the egress proxy, not Maplerad — Maplerad never
      // answered. Surface the proxy's own words (its body uses `error`/`detail`,
      // which the client's message extraction, keyed on `message`, drops).
      const detail = proxyDetail(err.body);
      return `HTTP ${err.status} from the egress proxy (MAPLERAD_BASE_URL), not from Maplerad — the proxy could not reach Maplerad for this path.${
        detail ? ` Proxy said: "${detail}".` : ""
      } If reads on other paths pass but this one fails, the proxy's allowlist or timeout is scoped per-path; open POST/GET /issuing and give it a generous timeout.`;
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

    // Prints identifiers rather than just a count so this confirms what we now
    // send. We used to guess per-network codes ("mtn-ng" and friends); the
    // POST /bills/airtime enum settled it as a single country-level
    // "ng-airtime", which is what both lib/bills.ts and payments/maplerad.ts
    // use. If this ever returns something else, airtime purchases are failing
    // after the customer has been debited — treat it as launch-blocking.
    probes.push(
      await probe(
        "Airtime billers",
        "Airtime can be sold, and which identifiers Maplerad actually publishes",
        async () => {
          const billers = await getBillers("airtime");
          if (billers.length === 0) throw new Error("No airtime billers returned");
          return billers.map((b) => `${b.name} (${b.identifier})`).join(", ");
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

    // Card issuing. This is the one path card creation needs and the one that
    // fails in production: POST /issuing returns 502 "upstream unreachable"
    // from the egress proxy while every probe above passes. A POST cannot be
    // probed safely (it would mint a real card), so this READS the same path
    // instead: GET /issuing/{a non-existent id}. We do not expect to find a
    // card — we expect Maplerad to ANSWER, with a 404. What is being tested is
    // whether the proxy can reach Maplerad on the /issuing path AT ALL.
    //
    //   - Maplerad answers (404/400/422) -> the proxy allows /issuing. The
    //     POST failure is then about the POST itself, and the overwhelmingly
    //     likely cause is the proxy timing out on the slower create call.
    //   - Still "upstream unreachable" (502/504/0) -> the whole /issuing prefix
    //     is unreachable through the proxy, i.e. a path allowlist that never
    //     included it. This is the same wall POST /issuing hits.
    const SENTINEL_CARD_ID = "00000000-0000-0000-0000-000000000000";
    probes.push(
      await probe(
        "Card issuing path reachable",
        "The proxy can reach Maplerad on /issuing — the hop card creation needs",
        async () => {
          try {
            // Try once: if the proxy times out slowly on /issuing, three
            // retries would exceed the page's 60s budget and this precise
            // answer would be lost behind a generic timeout.
            await getCard(SENTINEL_CARD_ID, { retries: 1 });
            // Finding a card for the sentinel id is impossible, but if the
            // provider somehow returns one the path is plainly reachable.
            return "Reached Maplerad on /issuing (unexpectedly found a card for the sentinel id).";
          } catch (err) {
            // A Maplerad answer — any real HTTP status — PROVES the proxy
            // reached the issuing path. Only a genuine unreachable is a failure.
            if (err instanceof MapleradError && !isUnreachable(err)) {
              return `Reached Maplerad on /issuing: it answered HTTP ${err.status} for a non-existent card, which is expected. The proxy allows this path, so POST /issuing failing points at the POST itself — most likely the proxy timing out on the slower card-creation call. Check the proxy's timeout for /issuing.`;
            }
            // Re-throw the unreachable so it lands in the failure branch with a
            // targeted message (see describe()).
            throw err;
          }
        },
      ),
    );

    const failed = probes.filter((p) => !p.ok);
    const allForbidden =
      failed.length === probes.length &&
      failed.every((p) => p.detail.startsWith("HTTP 403"));

    // The specific pattern behind the card-creation outage: the issuing path
    // is the ONLY thing that fails, and it fails unreachable. That is not a
    // credentials or IP problem — those would take down every probe — it is
    // the proxy declining or timing out on /issuing alone.
    const issuingProbe = probes.find((p) => p.name === "Card issuing path reachable");
    const issuingIsolated =
      issuingProbe !== undefined &&
      !issuingProbe.ok &&
      failed.length === 1 &&
      failed[0] === issuingProbe;

    const summary = allForbidden
      ? "Every call was rejected with 403. This server's outbound IP is not whitelisted with Maplerad — the keys themselves may be fine. See apps/api/GO-LIVE.md."
      : issuingIsolated
        ? "Everything works EXCEPT card issuing: the proxy reaches Maplerad for banks, wallets and bills but not for /issuing. This is the cause of card creation failing. It is not credentials or IP (those would fail every check) — the egress proxy at MAPLERAD_BASE_URL is not passing the /issuing path. Open it (both GET and POST) with a generous timeout, since card creation is slower than the other calls."
        : failed.length === 0
          ? "All checks passed, including the card-issuing path. Maplerad is reachable and usable from this deployment — card creation should work; turn on the virtual_cards flag."
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
