# CheqPay — Go-Live / Production Readiness Checklist

Status legend: ☐ not started · ◐ in progress · ☑ done

This is the path from "working demo" to a real-money, Play-Store-ready app.
Work top-to-bottom — the earlier sections gate the later ones.

---

## 1. Secrets & credentials (do first)

- ☐ **Rotate every secret that was ever pasted in chat or committed history**
  - Tatum mainnet API key (the one shared earlier — assume burned)
  - Supabase DB password
  - `ADMIN_API_SECRET` (rotate, then update backend + admin env)
- ☐ Confirm `.env*` is gitignored and no secret is in git history
  (`git log -p | grep -i secret` spot-check; rotate anything found).
- ☐ Store all secrets only in Vercel project env vars (never in the repo).

## 2. Deployment pipeline (currently the blocker)

- ☐ Delete duplicate Vercel projects: **`admin`**, **`cheqpay-web`**
      (they auto-deploy on every push and exhaust the free 100/day cap).
- ☐ Keep + verify the three real projects:
  - `cheqpy` → web (apps/web)
  - `cheqpay-admin453` → api (apps/api)
  - `cheqpay-admin` → admin (apps/admin)
- ☐ On `cheqpay-admin`: set env `ADMIN_API_SECRET` (matches backend) and
      redeploy; confirm the **Bill Logos** page loads.
- ☐ Consider Vercel Pro if the 100/day deploy cap keeps blocking releases.
- ☐ (Optional) switch the deploy workflow to **main-only** to halve deploy churn.

## 3. Provider integrations — move OFF mock

- ☐ **Custody (Tatum)**: set `CUSTODY_PROVIDER=tatum` + a **fresh** `TATUM_API_KEY`
      and `TATUM_WEBHOOK_SECRET`. Verify: wallet creation, deposit webhook,
      withdrawal broadcast on a small real amount.
- ☐ **Payments (Flutterwave)**: set `PAYMENT_PROVIDER=flutterwave` +
      `FLUTTERWAVE_SECRET_KEY` + `FLUTTERWAVE_WEBHOOK_HASH`. Verify: NGN deposit
      (virtual account/charge), NGN payout, and **bill payments** against the
      live Bills API (validate biller codes — they are currently best-effort).
- ☐ **KYC (Dojah)**: set `KYC_PROVIDER=dojah` + `DOJAH_APP_ID` / `DOJAH_API_KEY`
      (enable the BVN product on your Dojah account). Verify: submitting a real
      BVN + matching name auto-approves to tier 2; mismatches fall to the admin
      review queue. Mock is the safe default until keys are set.
- ☐ **Price feed**: confirm `PRICE_FEED=live` and Binance/CoinGecko reachable
      from Vercel in production.
- ☐ Set the business rate + spread in admin **Trading Settings**
      (`BUSINESS_USDT_NGN_RATE` / `SWAP_SPREAD_BPS`).

## 4. Money-safety & security review

- ☐ Set **`RELAX_WITHDRAWAL_GUARDS=false`** (or remove) in production so MFA
      (AAL2) + KYC tier-2 gates are enforced on withdrawals.
- ☐ Confirm MFA enrolment flow exists for users who want to withdraw crypto.
- ☐ Re-confirm idempotency keys on every money endpoint (swaps, withdrawals,
      bills, deposits) and webhook signature verification.
- ☐ Verify atomic debit/refund paths (insufficient funds, provider failure).
- ☐ Run the `/security-review` over the diff; address findings.
- ☐ Rate limits sane for production volume.

## 5. Data & reliability

- ☐ Confirm all Prisma migrations are applied to prod DB (0001–0004 + enum adds
      CONVERT/BILL). `biller_assets` table present.
- ☐ Supabase: enable Point-in-Time Recovery / backups.
- ☐ Use the Supabase **pooler** URL (port 6543, pgbouncer=true) in prod, not the
      IPv6-only direct host.
- ☐ Add basic error monitoring (e.g. Sentry) on web + api.
- ☐ `/api/health` and `/api/ready` wired to an uptime monitor.

## 6. Compliance & legal

- ☐ Replace placeholder contact details (phone/WhatsApp/address) in
      Support/Contact pages.
- ☐ Have the Privacy Policy / Terms / AML pages reviewed by counsel; publish a
      canonical Privacy Policy URL (Play requires one).
- ☐ KYC/AML: confirm tier gating + sanctions screening behaviour with real data.
- ☐ Crypto + remittance licensing posture confirmed for Nigeria.

## 7. Mobile / Play Store packaging

- ☐ Decide wrapper: **TWA (Trusted Web Activity)** of the PWA, or the existing
      `apps/mobile` (Expo) build.
- ☐ PWA: verify installability, icons, offline shell, `manifest` (already added).
- ☐ For TWA: `assetlinks.json` Digital Asset Links hosted on the web domain.
- ☐ Custom production domain (e.g. app.cheqpay.com) + HTTPS.
- ☐ Play Console: listing, screenshots, data-safety form, content rating,
      privacy policy URL, target API level.
- ☐ Crypto/financial app policy compliance for Play.

## 8. Pre-launch QA (end-to-end on production, small real amounts)

- ☐ Sign up → KYC → deposit NGN → buy BTC → sell BTC → NGN balance updates.
- ☐ Convert BTC↔USDT; balances + history update.
- ☐ Receive crypto (real address) and Send crypto (real withdrawal).
- ☐ Pay each bill type via Flutterwave.
- ☐ Transactions history correct across home/crypto/history.
- ☐ Admin: trading settings, bill logos, view users/transactions.

---

## 9. Future features (post-launch backlog)

- ☐ **NFC tap-to-share (native app only)** — let users share a crypto wallet
      address (and optionally bank details) by tapping phones / an NFC card.
  - Build in `apps/mobile` with `react-native-nfc-manager` (read/write) +
    `react-native-hce` (Android tap-to-share). Requires an EAS build / custom
    dev client (not Expo Go) and a physical device to test.
  - Platform reality: tap-to-**share** is **Android only** (iOS can't emulate a
    card); tap-to-**receive** works on Android + iOS. Always ship a **QR
    fallback** so iPhone senders / any device still work.
  - Start crypto-only (addresses are public = safe); gate bank details behind a
    confirm step. Add Play Console NFC permission declarations.
  - Not feasible in the web/PWA build — native only.

---

### Owner notes
- Items I can do in code: deploy workflow, guard flags, monitoring wiring,
  TWA/assetlinks, QA fixes.
- Items only you can do (dashboard/keys/legal): rotate secrets, set provider
  keys + env vars, delete dup Vercel projects, legal review, Play Console.


<!-- deploy: trigger clean admin production build (root dir apps/admin) -->

<!-- deploy: trigger clean admin production build -->
