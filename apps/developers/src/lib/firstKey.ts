// The secret of the test key made when an account is opened, carried from the
// "Open account" form to the first-call page and then forgotten.
//
// Held in memory only, never in localStorage or the URL: it is a credential.
// A reload loses it, which is fine — the first-call page makes a new test key
// in one click, and the old one can be revoked on the Keys page.

let pending: string | null = null;

export function handOverFirstKey(secret: string): void {
  pending = secret;
}

export function takeFirstKey(): string | null {
  const s = pending;
  pending = null;
  return s;
}
