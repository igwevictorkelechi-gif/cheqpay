import { prisma } from "@cheqpay/db";

/**
 * Admin-controlled in-app popup (announcement / promo). Stored as one JSON
 * blob in platform_settings. `id` changes on every save so clients that
 * dismissed an older popup show the new one.
 */
export interface AppPopup {
  id: string;
  enabled: boolean;
  title: string;
  message: string;
  /** https URL or data: URL uploaded from the admin dashboard. */
  imageUrl: string | null;
  buttonText: string | null;
  /** In-app path (e.g. /deposit) or https link the button opens. */
  buttonUrl: string | null;
}

const KEY = "app_popup";

export async function getAppPopup(): Promise<AppPopup | null> {
  const row = await prisma.platformSetting.findUnique({ where: { key: KEY } });
  if (!row) return null;
  try {
    const p = JSON.parse(row.value) as AppPopup;
    if (!p || typeof p !== "object" || typeof p.title !== "string") return null;
    return p;
  } catch {
    return null;
  }
}

export async function setAppPopup(
  input: Omit<AppPopup, "id">,
  updatedBy?: string
): Promise<AppPopup> {
  const popup: AppPopup = { ...input, id: crypto.randomUUID() };
  await prisma.platformSetting.upsert({
    where: { key: KEY },
    update: { value: JSON.stringify(popup), updatedBy },
    create: { key: KEY, value: JSON.stringify(popup), updatedBy },
  });
  return popup;
}
