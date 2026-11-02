// apps/api/src/lib/social/providers/types.ts
//
// One interface every social platform implements, so the OAuth routes and the
// publisher never branch on the platform. Meta is one provider that yields two
// kinds of account (Facebook Pages and the Instagram accounts linked to them).

import type { MediaKind, Platform } from "../rules";

export type ProviderId = "meta" | "x" | "tiktok" | "linkedin";

/** An account a successful login gave us, ready to store. */
export interface ConnectedProfile {
  platform: Platform;
  externalId: string;
  name: string;
  username?: string | null;
  avatarUrl?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  refreshExpiresAt?: Date | null;
  meta?: Record<string, unknown>;
}

/** A stored account, tokens decrypted, as the publisher hands it to a provider. */
export interface AccountForPublish {
  id: string;
  platform: Platform;
  externalId: string;
  name: string;
  username: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  meta: Record<string, unknown>;
}

export interface MediaForPublish {
  id: string;
  kind: MediaKind;
  mime: string;
  size: number;
  storagePath: string;
}

export interface PublishContext {
  account: AccountForPublish;
  caption: string;
  media: MediaForPublish[];
  /** What earlier attempts of THIS target got done (upload ids, containers…). */
  stage: Record<string, unknown>;
  /** A short-lived link the platform can download the file from. */
  signedUrl(m: MediaForPublish): Promise<string>;
  /** A link on our own API domain (for platforms that require a verified domain). */
  proxiedUrl(m: MediaForPublish): string;
  /** The file's bytes, for platforms that take an upload. */
  bytes(m: MediaForPublish): Promise<Buffer>;
}

export type StepResult =
  | { done: true; externalId: string; url: string | null }
  | { done: false; stage: Record<string, unknown>; retryInSec: number };

export interface RefreshedTokens {
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  refreshExpiresAt?: Date | null;
}

export interface SocialProvider {
  id: ProviderId;
  label: string;
  /** The account kinds a login with this provider can yield. */
  platforms: Platform[];
  /** Its app keys are set, so it can be offered. */
  configured(): boolean;
  /** The provider expects a PKCE code challenge (S256). */
  usesPkce: boolean;
  authorizeUrl(p: { state: string; redirectUri: string; codeChallenge?: string }): string;
  exchange(p: { code: string; redirectUri: string; codeVerifier?: string }): Promise<ConnectedProfile[]>;
  refresh?(account: AccountForPublish): Promise<RefreshedTokens>;
  /** Advance one target by one step. Called again with the returned stage until done. */
  publish(ctx: PublishContext): Promise<StepResult>;
}

/**
 * A platform said no. `retryable` errors (rate limits, outages) are tried again
 * later; `reconnect` means the login is no longer valid and someone must
 * reconnect the account; anything else fails the target with the message.
 */
export class SocialError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    readonly reconnect = false,
  ) {
    super(message);
    this.name = "SocialError";
  }
}

/** True for HTTP statuses worth retrying. */
export const transientStatus = (status: number) => status === 429 || status >= 500 || status === 0;
