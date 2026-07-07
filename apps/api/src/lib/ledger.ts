import { Asset, Prisma, TransactionStatus, TransactionType, prisma } from "@cheqpay/db";

/**
 * Atomically credit a user's balance and record the ledger transaction within
 * a single DB transaction. Amounts are minor units (BigInt). Used by deposit
 * crediting and buy/sell settlement (later phases).
 */
export async function creditBalance(params: {
  userId: string;
  asset: Asset;
  amountMinor: bigint;
  type: TransactionType;
  idempotencyKey: string;
  network?: Prisma.TransactionCreateInput["network"];
  txHash?: string;
  externalRef?: string;
  metadata?: Prisma.InputJsonValue;
  /** Optional fee (minor units) withheld from the credit: the balance is
   *  incremented by amount − fee, while the ledger records gross + fee. */
  feeMinor?: bigint;
}): Promise<{ created: boolean; transactionId: string }> {
  if (params.amountMinor <= 0n) {
    throw new Error("creditBalance requires a positive amount");
  }
  const fee = params.feeMinor ?? 0n;
  if (fee < 0n || fee >= params.amountMinor) {
    throw new Error("creditBalance fee must be >= 0 and < amount");
  }
  const net = params.amountMinor - fee;

  return prisma.$transaction(async (tx) => {
    // Idempotency: a repeated idempotencyKey must not double-credit.
    const existing = await tx.transaction.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) {
      return { created: false, transactionId: existing.id };
    }

    await tx.balance.upsert({
      where: { userId_asset: { userId: params.userId, asset: params.asset } },
      update: { available: { increment: net } },
      create: { userId: params.userId, asset: params.asset, available: net },
    });

    const record = await tx.transaction.create({
      data: {
        userId: params.userId,
        type: params.type,
        asset: params.asset,
        network: params.network,
        amount: params.amountMinor,
        fee,
        status: TransactionStatus.COMPLETED,
        txHash: params.txHash,
        externalRef: params.externalRef,
        idempotencyKey: params.idempotencyKey,
        metadata: params.metadata ?? {},
      },
    });

    return { created: true, transactionId: record.id };
  });
}

/**
 * Atomically debit available balance, refusing to go negative. Returns false
 * if there are insufficient funds (no state change).
 */
export async function debitBalance(params: {
  userId: string;
  asset: Asset;
  amountMinor: bigint;
}): Promise<boolean> {
  if (params.amountMinor <= 0n) {
    throw new Error("debitBalance requires a positive amount");
  }

  // Conditional update: only decrements when sufficient available funds exist.
  const updated = await prisma.balance.updateMany({
    where: {
      userId: params.userId,
      asset: params.asset,
      available: { gte: params.amountMinor },
    },
    data: { available: { decrement: params.amountMinor } },
  });
  return updated.count === 1;
}
