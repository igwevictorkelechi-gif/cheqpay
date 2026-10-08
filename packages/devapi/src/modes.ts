/** Test keys work on simulated money; live keys move real money. */
export const MODES = ["test", "live"] as const;
export type Mode = (typeof MODES)[number];

export const CURRENCIES = ["NGN", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Key format: `cp_test_sk_` or `cp_live_sk_`, then 43 base64url characters (256 bits). */
export const KEY_PATTERN = /^cp_(test|live)_sk_[A-Za-z0-9_-]{43}$/;

/** Anything that looks like one of our secret keys, for spotting keys where they must not be. */
export const KEY_LIKE = /cp_(?:test|live)_sk_[A-Za-z0-9_-]{20,}/;

export const API_BASE_URL = "https://api.mycheqpay.com/v1";
export const DEVELOPER_CONTACT = "dev@mycheqpay.com";
