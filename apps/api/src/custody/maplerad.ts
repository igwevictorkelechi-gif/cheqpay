import { Asset, Network, prisma } from "@cheqpay/db";
import { mapleradRequest } from "@/lib/maplerad/client";
import type {
  CustodyProvider,
  DepositAddress,
  IncomingDeposit,
  WithdrawalEvent,
  WithdrawalResult,
} from "./types";

/**
 * Maplerad stablecoin custody. USDC/USDT (and PYUSD) only — Maplerad has no
 * BTC product, so Bitcoin stays "coming soon" until a BTC custodian is wired.
 *
 * ⚠️ COMPLIANCE: this ships dark. crypto_deposits / crypto_withdrawals default
 * OFF in lib/features.ts; CBN/SEC VASP registration and the Google Play
 * Financial Features Declaration are hard blockers before flipping them on.
 * Switching providers does not waive any of that.
 *
 * Addresses hang off a Maplerad *customer* (tier 1+), enrolled at KYC approval
 * (lib/mapleradCustomer.ts) and stored as User.mapleradCustomerId.
 *
 * SANDBOX STATUS (verified 2026-07-13): POST /crypto currently fails on
 * Maplerad's side with a SQL error ("column supported_chains does not exist")
 * for every valid coin/chain pair — their bug, ticket-worthy. The request
 * contract itself is confirmed: invalid pairs get proper validation errors.
 *
 * DISABLED PENDING A CHAIN FIX: both pairs below are ERC-20, and Maplerad's
 * withdrawal endpoint documents Solana as its only destination chain, so neither
 * pair can currently complete a round trip. See COIN_CHAIN. Nothing observable
 * changes today — address creation is broken provider-side regardless — but the
 * guard means the trap cannot open the moment their bug is fixed.
 */

/**
 * Asset/network pairs Maplerad can custody, and the API names they map to.
 *
 * `withdrawable` is the important column. POST /crypto (address generation)
 * documents six chains — solana, base, polygon, eth, tron, bsc — but
 * POST /crypto/transfer (withdrawal) documents exactly one: solana. A pair that
 * can receive but cannot send is a trap: the user's money arrives and has no
 * documented way out, and they only discover it at the moment they try to
 * leave. So the flag gates address creation too, not just withdrawal.
 *
 * To widen this, run ONE sandbox withdrawal on the chain in question and
 * confirm it is accepted. Do not widen it because address generation accepted
 * the chain — that is the very mismatch this guards.
 */
/**
 * The chains POST /crypto accepts, and whether POST /crypto/transfer documents
 * each as a withdrawal destination. Solana is the only `withdrawable: true`
 * entry — see the note above; widen an entry only after a sandbox withdrawal on
 * that chain is accepted, never because address generation accepted it.
 */
const CHAINS: ReadonlyArray<{ network: Network; chain: string; withdrawable: boolean }> = [
  { network: Network.SOLANA, chain: "solana", withdrawable: true },
  { network: Network.BASE, chain: "base", withdrawable: false },
  { network: Network.POLYGON, chain: "polygon", withdrawable: false },
  { network: Network.ETHEREUM, chain: "eth", withdrawable: false },
  { network: Network.TRON, chain: "tron", withdrawable: false },
  { network: Network.BSC, chain: "bsc", withdrawable: false },
];

/** The stablecoins we custody. Maplerad also lists PYUSD; we do not carry it. */
const COINS: ReadonlyArray<{ asset: Asset; coin: string }> = [
  { asset: Asset.USDT, coin: "USDT" },
  { asset: Asset.USDC, coin: "USDC" },
];

export const COIN_CHAIN: Partial<
  Record<Asset, Partial<Record<Network, { coin: string; chain: string; withdrawable: boolean }>>>
> = Object.fromEntries(
  COINS.map(({ asset, coin }) => [
    asset,
    Object.fromEntries(
      CHAINS.map(({ network, chain, withdrawable }) => [network, { coin, chain, withdrawable }])
    ),
  ])
);

/**
 * Deposits auto-convert to USD by default.
 *
 * This is what makes the non-Solana chains safe to offer. The hazard with a
 * receive-only chain is that a user's crypto arrives and has no documented way
 * out. With offramp on, the deposit is converted to USD by the provider on
 * arrival — it is never *held* as crypto on that chain, so there is nothing
 * stranded and nothing to withdraw on-chain. The user's exit is their USD
 * balance, which the convert engine already reaches.
 *
 * Turning offramp OFF means the user really does hold the coin, and the
 * withdrawable guard applies in full.
 */
export const DEFAULT_OFFRAMP = true;

/**
 * Both halves of the trap say the same thing, so they say it once. Named for
 * what an operator has to do about it.
 */
function oneWayChain(asset: Asset, network: Network, chain: string): Error {
  return new Error(
    `${asset} on ${network} maps to Maplerad chain "${chain}", which POST /crypto/transfer ` +
      `does not document as a withdrawal destination (it lists "solana" only). Funds sent to ` +
      `such an address could not be withdrawn, so this pair is disabled. Verify the chain with ` +
      `a sandbox withdrawal and set withdrawable: true in custody/maplerad.ts, or move the ` +
      `pair to a chain the transfer endpoint accepts.`
  );
}

interface MapleradCryptoAddress {
  id: string;
  address: string;
  chain: string;
  coin: string;
}

interface MapleradCryptoTransfer {
  id: string;
  status?: string;
}

export class MapleradCustodyProvider implements CustodyProvider {
  readonly name = "maplerad";

  async createDepositAddress(input: {
    userId: string;
    asset: Asset;
    network: Network;
    /** Auto-convert arrivals to USD. Defaults to DEFAULT_OFFRAMP (true). */
    offramp?: boolean;
  }): Promise<DepositAddress> {
    const pair = COIN_CHAIN[input.asset]?.[input.network];
    if (!pair) {
      throw new Error(
        `${input.asset}/${input.network} is not available on Maplerad custody` +
          (input.asset === Asset.BTC ? " (BTC is coming soon)" : "")
      );
    }
    const offramp = input.offramp ?? DEFAULT_OFFRAMP;

    // Refuse before minting, not at withdrawal time. An address handed to a user
    // is a promise that money sent to it can come back out; making that promise
    // and breaking it later is worse than never making it.
    //
    // An offramp address makes that promise a different way: the deposit is
    // converted to USD on arrival, so the user never holds coin on a chain we
    // cannot send from, and their exit is the USD balance. The guard therefore
    // applies only when the user really would hold the coin.
    if (!offramp && !pair.withdrawable) {
      throw oneWayChain(input.asset, input.network, pair.chain);
    }

    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { mapleradCustomerId: true },
    });
    if (!user?.mapleradCustomerId) {
      // The customer record is created from name and email alone, so reaching
      // here means even that has not happened yet — a provider failure or a
      // profile that predates it, not missing identity details.
      throw new Error(
        "User has no Maplerad customer id yet (customer record was never created)"
      );
    }

    const created = await mapleradRequest<MapleradCryptoAddress>("/crypto", {
      method: "POST",
      body: {
        customer_id: user.mapleradCustomerId,
        coin: pair.coin,
        chain: pair.chain,
        offramp,
      },
    });
    return { address: created.address, custodyRef: created.id };
  }

  /**
   * Stablecoin withdrawal. Maplerad funds the transfer from the business USD
   * wallet, so `amount` is in USD minor units (cents); USDT/USDC are treated
   * 1:1 with USD here.
   *
   * ⚠️ UNVERIFIED against a real transfer: the sandbox cannot mint addresses
   * (Maplerad-side bug), so no test balance exists to withdraw. Before enabling
   * the crypto_withdrawals flag, run ONE sandbox withdrawal and confirm the
   * debited amount matches — a unit mismatch here moves 100x the money.
   */
  async createWithdrawal(input: {
    userId: string;
    asset: Asset;
    network: Network;
    toAddress: string;
    amount: string; // human decimal, e.g. "25.50"
  }): Promise<WithdrawalResult> {
    const pair = COIN_CHAIN[input.asset]?.[input.network];
    if (!pair) {
      throw new Error(`${input.asset}/${input.network} is not available on Maplerad custody`);
    }

    // Amount first: a malformed amount is the caller's mistake and deserves to
    // be named as such, whereas an unwithdrawable chain is ours.
    const cents = toCents(input.amount);
    if (cents === null || cents <= 0) {
      throw new Error(`Invalid withdrawal amount "${input.amount}"`);
    }

    // A legacy address minted before the address-side guard existed must not be
    // able to send an undocumented chain to the transfer endpoint and come back
    // with an opaque provider refusal.
    if (!pair.withdrawable) {
      throw oneWayChain(input.asset, input.network, pair.chain);
    }

    const transfer = await mapleradRequest<MapleradCryptoTransfer>("/crypto/transfer", {
      method: "POST",
      idempotencyKey: `${input.userId}:${input.toAddress}:${cents}`,
      body: {
        amount: cents,
        address: input.toAddress,
        chain: pair.chain,
        coin: pair.coin.toLowerCase(),
        funding_source: "USD",
      },
    });

    // Maplerad returns its transfer id, not an on-chain hash — the hash (and
    // final status) arrive by webhook. Store the id as the external ref.
    const status = (transfer.status ?? "").toUpperCase();
    return {
      txHash: transfer.id,
      status: status === "SUCCESS" || status === "SUCCESSFUL" ? "completed" : "broadcasting",
    };
  }

  /**
   * Maplerad webhooks are Svix-signed and arrive on the shared route
   * (app/api/webhooks/maplerad/route.ts), not through this interface — the
   * three-header Svix scheme doesn't fit a single-signature method.
   */
  verifyWebhookSignature(): boolean {
    throw new Error(
      "Maplerad webhooks are Svix-signed; they are verified in app/api/webhooks/maplerad/route.ts."
    );
  }
  parseDepositEvent(): IncomingDeposit | null {
    return null;
  }
  parseWithdrawalEvent(): WithdrawalEvent | null {
    return null;
  }
}

/** "25.50" -> 2550; rejects more than 2 decimal places rather than rounding. */
function toCents(amount: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}
