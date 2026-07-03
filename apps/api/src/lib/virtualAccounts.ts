import { Asset, Network, Prisma, prisma } from "@cheqpay/db";
import { getPaymentProvider } from "@/payments";

export interface VirtualAccountView {
  accountNumber: string;
  bankName: string;
  bankCode?: string;
  permanent: boolean;
}

interface VaMeta {
  providerRef: string;
  bankName: string;
  bankCode?: string;
  permanent: boolean;
}

/**
 * The user's NGN virtual account is stored as a FIAT "wallet" row:
 *   address    = the NUBAN (account number)
 *   custodyRef = JSON metadata (provider ref, bank name/code, permanence)
 * This reuses the existing Wallet model — no schema migration — and never
 * collides with the crypto wallets (BTC/USDT), which are BITCOIN/TRON.
 */
export async function getVirtualAccount(
  userId: string
): Promise<VirtualAccountView | null> {
  const w = await prisma.wallet.findUnique({
    where: {
      userId_asset_network: {
        userId,
        asset: Asset.NGN,
        network: Network.FIAT,
      },
    },
  });
  if (!w) return null;
  const meta = parseMeta(w.custodyRef);
  return {
    accountNumber: w.address,
    bankName: meta.bankName,
    bankCode: meta.bankCode,
    permanent: meta.permanent,
  };
}

/**
 * Create (idempotently) the user's NGN virtual account via the PSP and persist
 * it. A valid BVN mints a PERMANENT NUBAN; otherwise a temporary one.
 */
export async function createVirtualAccount(
  userId: string,
  email: string,
  req: { firstName: string; lastName: string; phone?: string; bvn?: string }
): Promise<VirtualAccountView> {
  const existing = await getVirtualAccount(userId);
  if (existing) return existing;

  const permanent = Boolean(req.bvn);
  const txRef = `va_${userId}_${Date.now()}`;

  const psp = getPaymentProvider();
  const result = await psp.createVirtualAccount({
    email,
    firstName: req.firstName,
    lastName: req.lastName,
    phone: req.phone,
    bvn: req.bvn,
    permanent,
    txRef,
  });

  const meta: VaMeta = {
    providerRef: result.providerRef,
    bankName: result.bankName,
    bankCode: result.bankCode,
    permanent: result.permanent,
  };

  try {
    await prisma.wallet.create({
      data: {
        userId,
        asset: Asset.NGN,
        network: Network.FIAT,
        address: result.accountNumber,
        custodyRef: JSON.stringify(meta),
      },
    });
    await prisma.auditLog.create({
      data: {
        userId,
        action: "ngn.virtual_account.created",
        resourceType: "Wallet",
        details: {
          bankName: result.bankName,
          permanent: result.permanent,
          providerRef: result.providerRef,
        },
      },
    });
  } catch (err) {
    // Lost a race with a concurrent create — return the winner's account.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await getVirtualAccount(userId);
      if (again) return again;
    }
    throw err;
  }

  return {
    accountNumber: result.accountNumber,
    bankName: result.bankName,
    bankCode: result.bankCode,
    permanent: result.permanent,
  };
}

function parseMeta(raw: string): VaMeta {
  try {
    const p = JSON.parse(raw) as Partial<VaMeta>;
    return {
      providerRef: String(p.providerRef ?? ""),
      bankName: String(p.bankName ?? "Bank"),
      bankCode: p.bankCode ? String(p.bankCode) : undefined,
      permanent: Boolean(p.permanent),
    };
  } catch {
    return { providerRef: "", bankName: "Bank", permanent: false };
  }
}
