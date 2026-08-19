# Going live

The sequence for turning CheqPay from a working build into a service that moves
real money. Host-agnostic — do [VPS.md](./VPS.md) or [RENDER.md](./RENDER.md)
first, then this.

**The ordering is the point.** Each step assumes the one before it. Taken out of
order the failures are misleading: an IP-whitelist rejection looks exactly like a
broken integration, and a feature flag flipped before its provider is live debits
users for things that never get delivered.

---

## 0. Prerequisite: a host with a static IP

Maplerad whitelists the IP addresses that call their API. **Vercel serverless has
no static egress IP**, so a live Maplerad key cannot work there — every call is
rejected at the whitelist.

> Do not set `PAYMENT_PROVIDER=maplerad` while the API is on Vercel.

Finish the hosting runbook first. Everything below assumes the API is serving
from its final host on a fixed address.

## 1. Whitelist and webhooks

- [ ] Add the server's outbound IP(s) to the Maplerad dashboard.
      A VPS has one. Render has **three** — add all of them, or you get
      intermittent failures that look like Maplerad being flaky.
- [ ] Point Maplerad's webhook at `https://<your-domain>/api/webhooks/maplerad`
- [ ] Copy the Svix signing secret (`whsec_…`) into `MAPLERAD_WEBHOOK_SECRET`
- [ ] Set `API_PUBLIC_URL` to the public origin, no trailing slash

## 2. Move the clients

- [ ] Admin (`cheqpay-admin` on Vercel): `CHEQPAY_API_URL`
- [ ] Web (`cheqpy` on Vercel): `NEXT_PUBLIC_API_URL`
- [ ] Mobile: `EXPO_PUBLIC_API_URL`, then a **new EAS build**

Mobile is the slow one — `EXPO_PUBLIC_*` is inlined at build time, so installed
apps keep calling the old host until users update. Leave the Vercel deployment
running until the new build has rolled out; it is also your rollback.

- [ ] Verify: log in on web, load every admin page, `curl /api/health`

## 3. Go live on the provider

Only once steps 1 and 2 are verified.

```ini
MAPLERAD_SECRET_KEY=<LIVE key, not sandbox>
PAYMENT_PROVIDER=maplerad
CUSTODY_PROVIDER=maplerad
```

- [ ] Confirm in the admin dashboard → Provider Settings that the mode reads
      `maplerad` and the key/webhook show as configured
- [ ] Confirm `RELAX_WITHDRAWAL_GUARDS` is **unset** — it disables the MFA and
      KYC-tier gates on crypto withdrawals

## 4. Flags, one at a time

These default OFF for specific reasons (see `lib/features.ts`). Turn them on in
the admin dashboard **one per step, with a real transaction between each**. All
at once and you will not know which one broke.

| Order | Flag | Prove it with | Watch for |
|---|---|---|---|
| 1 | `ngn_deposits` | Fund an account with ₦100 by bank transfer | Virtual-account creation used to fail before collections were enabled. Confirm the account number is issued, then that the credit lands. |
| 2 | `ngn_withdrawals` | Pay ₦100 back out to a bank account | Name enquiry resolves; the payout settles; the webhook marks it complete. |
| 3 | `bill_payments` | Buy the smallest airtime top-up | The plan list is now fetched live from Maplerad, so it should match their catalogue exactly. Verify the airtime actually **arrives** — a successful API response is not delivery. |
| 4 | `virtual_cards` | Issue one card | Issuing is asynchronous and reconciled by webhook. The card must reach a final state, not just be accepted. |
| 5 | `crypto_deposits` | Generate an address, send dust | **Two extra blockers** — see below. |
| 6 | `crypto_withdrawals` | Send dust out | Same blockers. |

After each: check the transaction in the admin dashboard, and confirm the email
alert arrived (needs `RESEND_API_KEY` + `MAIL_FROM`).

## 5. The crypto flags are not just a switch

`crypto_deposits` and `crypto_withdrawals` have prerequisites that Maplerad
enabling your account does **not** clear:

- **Maplerad's address endpoint** was failing on their side. Verify it returns an
  address in sandbox before trusting it with a user's funds.
- **CBN/SEC VASP registration.** Custodying crypto for Nigerian users is
  regulated. This is a licensing question, not a configuration one.
- **Google Play Financial Features Declaration.** Required for the Android build;
  it asks for the licence documentation from the point above.

Leave these two off until all three are genuinely resolved. Everything else in
this document can ship without them.

## 6. Before real users

- [ ] `RESEND_API_KEY` + `MAIL_FROM` set (statements and transaction alerts are
      written and dark until both are)
- [ ] Fees and cashback rate set in the admin dashboard — cashback is a direct
      cost of every transaction
- [ ] `BUSINESS_USDT_NGN_RATE` and `SWAP_SPREAD_BPS` reviewed; the spread is
      where the margin lives
- [ ] AML thresholds reviewed (`AML_*`) — the defaults are placeholders
- [ ] `CRON_SECRET` set and the price-alert job scheduled on the new host
- [ ] Float sized: Maplerad NGN balance covers **peak** daily outflow, not average
- [ ] `SENTRY_DSN` set, so failures are visible before users report them

## 7. Decommission Vercel

Only once everything above is verified **and** the mobile build has rolled out.

- [ ] Remove the `deploy-api` job from `.github/workflows/deploy-vercel.yml`
- [ ] Pause or delete the `cheqpay-admin453` project

Until then it costs nothing and it is the rollback.

---

## If something goes wrong

**Every Maplerad call fails.** Almost certainly the IP whitelist — check the
server's actual outbound IP (`curl ifconfig.me` on the box) against what is
registered. On Render, confirm all three are listed.

**Deposits are not credited.** The webhook is not arriving or not verifying.
Check Maplerad's webhook delivery log, then that `MAPLERAD_WEBHOOK_SECRET`
matches the Svix secret for *that* endpoint.

**A feature is off but you did not turn it off.** Flags live in
`platform_settings.feature_flags`. Anything not stored there falls back to the
default in `lib/features.ts`.

**Roll back the provider, not the host.** Setting `PAYMENT_PROVIDER=mock` stops
all real money movement immediately without touching the deployment. That is the
fastest lever if something is wrong with the rail rather than the server.
