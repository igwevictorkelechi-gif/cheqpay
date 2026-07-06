import { Asset, prisma } from "@cheqpay/db";
import { z } from "zod";

/**
 * Manual custody mode. Until a programmatic custody provider is live, the
 * business operates its own wallets: the admin sets one deposit address per
 * asset from the dashboard, users see that address on Receive, incoming
 * deposits are credited manually by the admin, and crypto withdrawals queue
 * for the admin to pay out by hand.
 *
 * Addresses live in platform_settings under one JSON blob, so changing them is
 * a dashboard action — no deploy.
 */

export const MANUAL_CRYPTO_KEY = "manual_crypto_wallets";

export const MANUAL_ASSETS = [Asset.BTC, Asset.USDT, Asset.USDC] as const;
export type ManualAsset = (typeof MANUAL_ASSETS)[number];

export interface ManualWalletEntry {
  address: string;
  /** Free-text network shown to users, e.g. "Tron (TRC-20)". */
  networkLabel: string;
  /** Our Network enum value used on ledger rows for this asset. */
  network: "BITCOIN" | "TRON" | "ETHEREUM" | "BSC";
}

export type ManualWallets = Partial<Record<ManualAsset, ManualWalletEntry>>;

const entrySchema = z.object({
  address: z.string().trim().min(15).max(120),
  networkLabel: z.string().trim().min(2).max(60),
  network: z.enum(["BITCOIN", "TRON", "ETHEREUM", "BSC"]),
});

export const manualWalletsSchema = z.object({
  BTC: entrySchema.nullable().optional(),
  USDT: entrySchema.nullable().optional(),
  USDC: entrySchema.nullable().optional(),
});

/** Read the configured manual wallets (empty object when none set). */
export async function getManualWallets(): Promise<ManualWallets> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: MANUAL_CRYPTO_KEY },
  });
  if (!row) return {};
  try {
    const parsed = manualWalletsSchema.parse(JSON.parse(row.value));
    const out: ManualWallets = {};
    for (const a of MANUAL_ASSETS) {
      const e = parsed[a];
      if (e) out[a] = e;
    }
    return out;
  } catch {
    // Corrupt/legacy value — treat as unset rather than erroring user flows.
    return {};
  }
}

/** Replace the manual wallet set (null/absent entries disable that asset). */
export async function setManualWallets(
  wallets: ManualWallets,
  updatedBy?: string
): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key: MANUAL_CRYPTO_KEY },
    update: { value: JSON.stringify(wallets), updatedBy },
    create: { key: MANUAL_CRYPTO_KEY, value: JSON.stringify(wallets), updatedBy },
  });
}

/** True when the given asset is served by a manually-managed wallet. */
export async function isManualAsset(asset: Asset): Promise<boolean> {
  if (!(MANUAL_ASSETS as readonly Asset[]).includes(asset)) return false;
  const wallets = await getManualWallets();
  return !!wallets[asset as ManualAsset];
}
