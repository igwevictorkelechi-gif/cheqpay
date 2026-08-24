import { Asset, Network, Prisma, prisma } from "@cheqpay/db";
import { createUsdAccount, type UsdAccountMeta } from "./maplerad/accounts";
import { ensureUsdAsset } from "./ensureUsdAsset";

/**
 * A user's USD virtual account, stored like the NGN one: a FIAT "wallet" row
 * with asset = USD. address is the account number, custodyRef the JSON metadata.
 * The USD/FIAT key never collides with NGN/FIAT or the crypto wallets.
 *
 * A USD account can require the holder's consent before it activates (US banking
 * rules), so unlike NGN it carries a status and, when consent is pending, a URL
 * the user must visit.
 */
export interface UsdAccountView {
  accountNumber: string;
  bankName: string;
  accountName?: string;
  currency: string;
  status?: string;
  consentRequired: boolean;
  consentUrl?: string | null;
}

interface UsdMeta {
  providerRef: string;
  bankName: string;
  accountName?: string;
  currency: string;
  status?: string;
  consentRequired: boolean;
  consentUrl?: string | null;
}

function parseMeta(raw: string): UsdMeta {
  try {
    const m = JSON.parse(raw) as Partial<UsdMeta>;
    return {
      providerRef: m.providerRef ?? "",
      bankName: m.bankName ?? "USD account",
      accountName: m.accountName,
      currency: m.currency ?? "USD",
      status: m.status,
      consentRequired: Boolean(m.consentRequired),
      consentUrl: m.consentUrl ?? null,
    };
  } catch {
    return { providerRef: "", bankName: "USD account", currency: "USD", consentRequired: false };
  }
}

function toView(w: { address: string; custodyRef: string }): UsdAccountView {
  const meta = parseMeta(w.custodyRef);
  return {
    accountNumber: w.address,
    bankName: meta.bankName,
    accountName: meta.accountName,
    currency: meta.currency,
    status: meta.status,
    consentRequired: meta.consentRequired,
    consentUrl: meta.consentUrl,
  };
}

/** The user's USD account, or null if they have not opened one. */
export async function getUsdAccount(userId: string): Promise<UsdAccountView | null> {
  const w = await prisma.wallet.findUnique({
    where: { userId_asset_network: { userId, asset: Asset.USD, network: Network.FIAT } },
  });
  return w ? toView(w) : null;
}

/**
 * Open (idempotently) the user's USD virtual account and persist it.
 *
 * Requires an enrolled Maplerad customer — the account hangs off the customer id
 * — so the caller must have run enrolment first. Idempotent: an existing account
 * is returned untouched rather than opening a second one.
 */
export async function createUsdVirtualAccount(
  userId: string,
  meta: UsdAccountMeta,
): Promise<UsdAccountView> {
  const existing = await getUsdAccount(userId);
  if (existing) return existing;

  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { mapleradCustomerId: true },
  });
  if (!owner?.mapleradCustomerId) {
    throw new Error("not_enrolled");
  }

  const result = await createUsdAccount({ customerId: owner.mapleradCustomerId, meta });

  const stored: UsdMeta = {
    providerRef: result.id,
    bankName: result.bank_name,
    accountName: result.account_name,
    currency: result.currency,
    status: result.status,
    consentRequired: Boolean(result.require_consent) && !result.consented,
    consentUrl: result.consent_url ?? null,
  };

  // The enum value must exist before the typed write; added on its own so it is
  // not used inside the same transaction that created it.
  await ensureUsdAsset();

  try {
    await prisma.wallet.create({
      data: {
        userId,
        asset: Asset.USD,
        network: Network.FIAT,
        address: result.account_number,
        custodyRef: JSON.stringify(stored),
      },
    });
  } catch (err) {
    // Lost a race with a concurrent open — return the winner's account.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await getUsdAccount(userId);
      if (again) return again;
    }
    throw err;
  }

  return toView({
    address: result.account_number,
    custodyRef: JSON.stringify(stored),
  });
}
