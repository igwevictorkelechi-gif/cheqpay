// apps/api/src/lib/devapi/walletMoves.ts
//
// Moving money between the owner's CheqPay app balance and their developer
// main wallet (live):
//
//   in   app balance → developer main wallet ("Add money")
//   out  developer main wallet → app balance ("Move out"); from there the owner
//        withdraws to a bank as usual, under the app's own withdrawal rules.
//
// Both ledgers live in the same database, so each move is ONE transaction: the
// app debit, the app ledger row, the developer transaction and its ledger
// entry commit together or not at all. Money is never in flight between them.
//
// The route in front of this requires the owner's 2FA and transaction PIN.

import { Asset, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";
import { ApiError } from "../http";
import { ensureUsdAsset } from "../ensureUsdAsset";
import { ensureDevApiSchema } from "./ensureDevApi";
import { ensureDevTxnTypes } from "./ensureDevTxnTypes";
import { applyLegs, ensureMainWallets, getMainWallet, getTransaction, insertTransaction, liveFloat } from "./ledger";
import { effectiveLimits, getDevLimits } from "./limits";
import { alertOwner, recordDevAudit } from "./audit";
import type { AccountRow, Currency, DevTransactionRow } from "./types";

const ASSET: Record<Currency, Asset> = { NGN: Asset.NGN, USD: Asset.USD };

/** Room to queue behind other movements on the same wallet without timing out. */
const MONEY_TX = { maxWait: 10_000, timeout: 15_000 };

export interface MoveInput {
  account: AccountRow;
  direction: "in" | "out";
  currency: Currency;
  amountMinor: bigint;
  /** The caller's Idempotency-Key; a repeat returns the first move. */
  idempotencyKey: string;
  /** The address that asked for the move, kept on both ledgers' rows. */
  initiatorIp: string | null;
  userAgent: string | null;
}

export async function moveMoney(input: MoveInput): Promise<{ transaction: DevTransactionRow; replay: boolean }> {
  const { account, direction, currency, amountMinor, initiatorIp } = input;
  if (account.status !== "approved") {
    throw new ApiError(403, "Your developer wallet opens once your business is verified.", "account_not_approved");
  }
  if (account.frozen) throw new ApiError(403, "Money movement is paused on this account.", "account_frozen");
  if (amountMinor <= 0n) throw new ApiError(400, "Enter an amount greater than zero.", "validation_error");
  if (!/^[A-Za-z0-9_.:-]{8,100}$/.test(input.idempotencyKey)) {
    throw new ApiError(400, "Missing or invalid Idempotency-Key header", "idempotency_key_required");
  }

  await ensureDevApiSchema();
  await Promise.all([ensureDevTxnTypes(), currency === "USD" ? ensureUsdAsset() : Promise.resolve()]);
  const limits = effectiveLimits(account, await getDevLimits());
  const appKey = `devmove:${account.id}:${input.idempotencyKey}`;
  const scope = { accountId: account.id, mode: "live" as const };

  const result = await prisma.$transaction(async (db) => {
    // A replay of the same request returns the move it already made.
    const prior = await db.transaction.findUnique({ where: { idempotencyKey: appKey }, select: { id: true, userId: true } });
    if (prior) {
      if (prior.userId !== account.owner_user_id) throw new ApiError(409, "Idempotency-Key already used", "idempotency_key_reused");
      const rows = await db.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM dev_transactions WHERE app_ledger_tx_id = $1::uuid AND account_id = $2::uuid`,
        prior.id,
        account.id,
      );
      return { id: rows[0]?.id ?? null, replay: true };
    }

    await ensureMainWallets(db, account.id, "live");
    const wallet = (await getMainWallet(db, account.id, "live", currency))!;

    if (direction === "in") {
      // Lock the wallet before reading the float so two adds can't both fit under the cap.
      await db.$queryRawUnsafe(`SELECT 1 FROM dev_wallets WHERE id = $1::uuid FOR NO KEY UPDATE`, wallet.id);
      const float = await liveFloat(db, account.id, currency);
      if (float + amountMinor > limits.maxFloat[currency]) {
        throw new ApiError(422, "That would take your developer wallets over the balance limit on your account.", "limit_exceeded");
      }
      const debit = await db.balance.updateMany({
        where: { userId: account.owner_user_id, asset: ASSET[currency], available: { gte: amountMinor } },
        data: { available: { decrement: amountMinor } },
      });
      if (debit.count !== 1) {
        throw new ApiError(422, `Your CheqPay ${currency} balance is too low for that.`, "insufficient_funds");
      }
    }

    const appTx = await db.transaction.create({
      data: {
        userId: account.owner_user_id,
        type: direction === "in" ? TransactionType.DEV_WALLET_FUND : TransactionType.DEV_WALLET_WITHDRAW,
        asset: ASSET[currency],
        amount: amountMinor,
        status: TransactionStatus.COMPLETED,
        idempotencyKey: appKey,
        metadata: { kind: "dev_wallet", direction, devAccountId: account.id, ip: initiatorIp },
      },
    });

    const txId = await insertTransaction(db, {
      accountId: account.id,
      mode: "live",
      kind: "wallet_move",
      status: "successful",
      currency,
      amountMinor,
      walletId: wallet.id,
      description: direction === "in" ? "Added from CheqPay balance" : "Moved to CheqPay balance",
      details: { direction },
      appLedgerTxId: appTx.id,
      initiatorIp,
    });
    await applyLegs(db, scope, txId, currency, [
      { walletId: wallet.id, amountMinor: direction === "in" ? amountMinor : -amountMinor, kind: direction === "in" ? "move_in" : "move_out" },
    ]);

    if (direction === "out") {
      await db.balance.upsert({
        where: { userId_asset: { userId: account.owner_user_id, asset: ASSET[currency] } },
        update: { available: { increment: amountMinor } },
        create: { userId: account.owner_user_id, asset: ASSET[currency], available: amountMinor },
      });
    }
    return { id: txId, replay: false };
  }, MONEY_TX);

  const transaction = result.id ? await getTransaction(prisma, scope, result.id) : null;
  if (!transaction) throw new ApiError(409, "That request is still being processed.", "idempotency_in_progress");
  if (!result.replay) {
    const amount = `${currency === "NGN" ? "₦" : "$"}${(Number(amountMinor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    await recordDevAudit({
      accountId: account.id,
      actor: "owner",
      action: direction === "in" ? "wallet.add_money" : "wallet.move_out",
      details: { currency, amount_minor: amountMinor.toString() },
      ip: initiatorIp,
      userAgent: input.userAgent,
    });
    if (direction === "out") {
      alertOwner(account, {
        title: "Money moved out of your developer wallet",
        body: `${amount} was moved from your developer main wallet to your CheqPay balance.`,
        details: [{ label: "IP address", value: initiatorIp ?? "unknown" }],
      });
    }
  }
  return { transaction, replay: result.replay };
}
