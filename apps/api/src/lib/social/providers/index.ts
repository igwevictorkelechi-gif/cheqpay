// apps/api/src/lib/social/providers/index.ts

import type { Platform } from "../rules";
import { linkedinProvider } from "./linkedin";
import { metaProvider } from "./meta";
import { tiktokProvider } from "./tiktok";
import type { ProviderId, SocialProvider } from "./types";
import { xProvider } from "./x";

export const PROVIDERS: Record<ProviderId, SocialProvider> = {
  meta: metaProvider,
  x: xProvider,
  tiktok: tiktokProvider,
  linkedin: linkedinProvider,
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PROVIDERS, v);
}

/** The provider that owns an account of this platform. */
export function providerFor(platform: Platform): SocialProvider {
  const p = Object.values(PROVIDERS).find((pr) => pr.platforms.includes(platform));
  if (!p) throw new Error(`No provider for ${platform}`);
  return p;
}
