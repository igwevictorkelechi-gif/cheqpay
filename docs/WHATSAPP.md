# WhatsApp bot

Users reach their account from WhatsApp: balance, recent transactions and Ajo.

## The rule everything else follows

**The bot never moves money.** It reads, and it composes. Anything that would
spend becomes a one-time link, confirmed with the transaction PIN on the
website by the routes that already exist.

This is not caution for its own sake. A WhatsApp transcript is backed up
unencrypted to Google Drive and iCloud, is readable on any linked WhatsApp Web
session, and the account behind it falls to a SIM swap. If the bot could spend,
all of that would be enough to drain a wallet.

Three things follow:

- **The PIN is never typed into the chat**, and the bot says so whenever a
  message looks like a PIN. CheqPay never asks for it there, so anyone who does
  is phishing.
- **No new money code exists.** Every control — `requireTransactionPin`,
  the KYC tier limits, idempotency, AML, the Ajo arrears lien — still applies,
  because the same route still runs.
- **No remote lockout.** Five wrong PINs lock an account for 15 minutes, then an
  hour, then a day. If PINs were accepted in chat, anyone who knew your number
  could lock you out of your own money. The PIN never reaching the bot removes
  that outright.

`src/lib/whatsapp/whatsapp.guard.test.ts` fails the build if anything under
`lib/whatsapp/` ever imports a money-moving helper.

## Connecting a number

A phone number is **not** a credential here. `User.phone` is nullable, is never
verified by any OTP flow in this codebase, is stored un-normalised, and is
silently dropped when two accounts collide (see `POST /api/me`). Matching an
incoming number against it would hand an account to whoever inherits a recycled
SIM.

So linking starts inside the signed-in app:

1. Settings → Security → Connect WhatsApp calls `POST /api/whatsapp/link`.
2. That returns a 6-character code — good for **10 minutes**, single use, stored
   only as sha256 — and a `wa.me` deep link with `LINK <CODE>` pre-typed.
3. The user sends it. The webhook spends the code and binds the number.
4. Both sides get told: an `auditLog` row, and a `security` notification on
   push/email. A silent takeover is the thing worth making loud.

Possessing the number proves nothing. Possessing the number *and* a code minted
by an authenticated session proves both halves.

One live number per user, one live user per number. Taking a new binding revokes
whatever either side held. Revoked rows are kept for the audit trail.

Disconnect from Settings → Security, or by sending `STOP`.

## What it answers

| Message | Reply |
| --- | --- |
| `balance` | Naira available, any crypto held, and a warning if Ajo arrears are blocking money-out |
| `recent` | The last 5 transactions |
| `ajo` | Saved, plans, circles, and anything owed |
| `help` | The list above |
| `stop` | Disconnects this number |
| `LINK ABC234` | Connects this number (the only thing an unlinked number may do) |

Anything else gets the help text. A message that looks like a PIN gets the
warning instead.

## Running it

- **Webhook:** `/api/webhooks/whatsapp`. `GET` answers Meta's subscription
  handshake; `POST` takes messages.
- **Feature flag:** `whatsapp_bot` (off by default). With it off the webhook
  still returns 200, so the subscription stays healthy and Meta does not
  disable the endpoint.
- **Tables** (raw SQL, created by `ensureWhatsappSchema()` at first use):
  `wa_links`, `wa_link_codes`, `wa_pending_actions`.
- **Rate limits:** 20 messages/min per number, 40/min per account, and 5 link
  attempts per 10 minutes. The link limit is what keeps a 6-character code from
  being guessable.

### Why the reply is not the HTTP response

Meta wants a `200` within about 20 seconds and disables an endpoint that keeps
missing it. A WhatsApp reply is a **separate** Graph POST, not the webhook's
response body — so the route verifies, claims the message, acknowledges, and
answers in `after()`. That is why the bot can afford to think before replying,
and why it must never be rewritten to answer synchronously.

Every message is claimed through `claimWebhookEvent("whatsapp", wamid, …)`
before the acknowledgement. Meta redelivers aggressively; without the claim a
redelivery would produce a second reply, or a second link.

### Environment

| Variable | What |
| --- | --- |
| `WHATSAPP_PHONE_NUMBER_ID` | The sender, from WhatsApp Manager |
| `WHATSAPP_ACCESS_TOKEN` | A System User token (the dashboard's 24h token is for local trials only) |
| `WHATSAPP_VERIFY_TOKEN` | Any random string; must match Meta's webhook form |
| `WHATSAPP_BOT_NUMBER` | The bot's public number, for the `wa.me` deep link |
| `META_APP_SECRET` | **Already set** for the social publisher — it signs the webhook too |

The WhatsApp Business account hangs off the same Meta app as Facebook/Instagram
publishing, so there is no second app secret.

`WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are in
`REAL_PROVIDER_KEYS`, so the pentest lab strips them. **Any new credential that
can reach a customer must be added there**, or the lab can message real people.

## Before the first real user

Three things outside this codebase have to be true, and none are quick:

- The number is registered on the WhatsApp Business account.
- Meta has verified the business.
- Message templates are approved — business-initiated messages outside Meta's
  **24-hour customer-service window** will not deliver without one. Replies
  inside the window are free-form, which is all the bot sends today.

And one legal item: routing account data through Meta makes Meta a **data
processor**. COMPLIANCE.md already lists NDPR handling as a client action item;
this widens it. The privacy policy and the consent shown at link time should be
reviewed by the same counsel engaged on the VASP/MSB question.

## Not built yet

Phases 4–6 of the plan:

- **Paying from chat** — `wa_pending_actions` exists and is created by the
  schema, but nothing writes to it yet. The design: the bot validates a payment
  to an **already-saved beneficiary** under a daily cap, then sends a one-time
  link to `/approve/<code>` on the website, where the existing
  `TransactionPinProvider` and the existing money route do the work.
  Note the cap matters more than it looks: P2P transfers and bill payments have
  **no KYC tier gate**, so for exactly what the bot can do, the WhatsApp cap is
  the ceiling rather than a second one.
- **Outbound alerts** — a `whatsapp` leg on `notifyUser`, reusing the existing
  notification categories. Needs the approved templates above.
- **Free text** — routing anything unrecognised into the existing
  `SUPPORT_FAQ` + Anthropic path in `/api/support/chat`, which today is welded
  to an HTTP session.

Out of reach by design: crypto withdrawals and card reveal need Supabase AAL2,
which a chat channel cannot produce.
