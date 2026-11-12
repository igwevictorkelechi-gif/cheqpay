// apps/api/src/lib/whatsapp/schema.ts
//
// The three tables the WhatsApp bot owns. Created on first use the same way
// ensureSsoSchema() and ensureAjoSchema() do, because nothing else selects them.
//
//   wa_links           which WhatsApp number is allowed to act for which user
//   wa_link_codes      the short code that proves the person at that number is
//                      the signed-in user (made in the app, spent in the chat)
//   wa_pending_actions a payment the bot composed, waiting to be confirmed with
//                      the PIN on the website
//
// Codes are stored only as sha256, exactly as sso_handoffs does: the plaintext
// exists in the message the user sends and nowhere else, so a database leak
// cannot be replayed into someone's account.

import { prisma } from "@cheqpay/db";

let ensured: Promise<void> | null = null;

export function ensureWhatsappSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS wa_links (
          wa_id        text PRIMARY KEY,
          user_id      uuid NOT NULL,
          linked_at    timestamptz NOT NULL DEFAULT now(),
          last_seen_at timestamptz,
          revoked_at   timestamptz
        )`);
      // One live WhatsApp number per user. Revoked rows are kept for the audit
      // trail, so the constraint only covers the live ones.
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS wa_links_live_user_idx
           ON wa_links (user_id) WHERE revoked_at IS NULL`,
      );

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS wa_link_codes (
          code_hash  text PRIMARY KEY,
          user_id    uuid NOT NULL,
          expires_at timestamptz NOT NULL,
          used_at    timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        )`);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS wa_link_codes_created_idx ON wa_link_codes (created_at)`,
      );

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS wa_pending_actions (
          code_hash  text PRIMARY KEY,
          user_id    uuid NOT NULL,
          kind       text NOT NULL,
          payload    jsonb NOT NULL,
          expires_at timestamptz NOT NULL,
          used_at    timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        )`);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS wa_pending_actions_created_idx ON wa_pending_actions (created_at)`,
      );
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

/** Test seam: forget that the tables were created. */
export function resetWhatsappSchemaCache(): void {
  ensured = null;
}
