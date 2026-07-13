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
 */

/** Asset/network pairs Maplerad can custody, and the API names they map to. */
const COIN_CHAIN: Partial<Record<Asset, Partial<Record<Network, { coin: string; chain: string }>>>> = {
  [Asset.USDT]: { [Network.ETHEREUM]: { coin: "USDT", chain: "eth" } },
  [Asset.USDC]: { [Network.ETHEREUM]: { coin: "USDC", chain: "eth" } },
};

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
  }): Promise<DepositAddress> {
    const pair = COIN_CHAIN[input.asset]?.[input.network];
    if (!pair) {
      throw new Error(
        `${input.asset}/${input.network} is not available on Maplerad custody` +
          (input.asset === Asset.BTC ? " (BTC is coming soon)" : "")
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { mapleradCustomerId: true },
    });
    if (!user?.mapleradCustomerId) {
      // Enrollment happens at KYC approval and needs phone + address; without
      // it there is no Maplerad customer to attach an address to.
      throw new Error(
        "User has no Maplerad customer id yet (KYC with phone + address required)"
      );
    }

    const created = await mapleradRequest<MapleradCryptoAddress>("/crypto", {
      method: "POST",
      body: {
        customer_id: user.mapleradCustomerId,
        coin: pair.coin,
        chain: pair.chain,
        offramp: false,
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

    const cents = toCents(input.amount);
    if (cents === null || cents <= 0) {
      throw new Error(`Invalid withdrawal amount "${input.amount}"`);
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
