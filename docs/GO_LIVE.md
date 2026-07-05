# CheqPay — Go-Live / Production Readiness Checklist

Status legend: ☐ not started · ◐ in progress · ☑ done

This is the path from "working demo" to a real-money, Play-Store-ready app.
Sections 1–8 are the launch gate; section 0 records what's already built.

---

## 0. Product build status (done in code, deployed to `main`)

Authentication & onboarding
- ☑ Email OTP auth (Supabase `signInWithOtp`/`verifyOtp`) on web + mobile
- ☑ Guided onboarding: Login/Signup → Email verification → KYC → PIN
- ☑ Unverified users (login *or* signup) routed through KYC; verified go home
- ☑ App requires login — web `AuthGuard` + mobile route guard block signed-out access
- ☑ Branded HTML email templates for all Supabase auth emails (`supabase/email-templates/`)

Wallet / money features (web + mobile)
- ☑ NGN⇄crypto buy/sell, BTC↔USDT convert, receive/send crypto
- ☑ Deposits (virtual account), NGN + crypto withdrawals, bill payments
- ☑ Ledger-backed transaction history; transaction details page
- ☑ Shareable **branded receipt** — PDF (mobile, expo-print) / PNG (web, canvas)

Profile → Preferences
- ☑ Preferences hub + Notifications, App Theme, App Icon screens

Notifications & push
- ☑ Per-category notification prefs persisted (`notification_prefs`)
- ☑ Expo push token registration + `sendPush`/`broadcastPush`
- ☑ Event pushes: deposits, withdrawals, trades, bills, security
- ☑ Daily price-alert cron (`/api/cron/price-alerts`)

Profile → Account
- ☑ Account hub, Personal details (editable username/DOB/next-of-kin), Account limits,
      Wallet statement (export), Delete account (real, cascade + optional auth delete)

Profile → Security
- ☑ 2FA (TOTP / Google Authenticator), Change password, App lock (PIN + Face ID),
      Instant withdrawal toggle

Admin dashboard
- ☑ Analytics page fixed (crypto section + recharts/victory-vendor d3 imports)
- ☑ Dashboard secured with a login gate (was fully open); default credential
      `admin@cheqpay.com` / `CheqPayAdmin!2026`, changeable from **Admin Profile**

Database migrations applied to prod
- ☑ 0001–0004 (init, CONVERT, BILL, biller_assets)
- ☑ 0005 notification prefs + push tokens
- ☑ 0006 profile fields (username/DOB/next-of-kin)
- ☑ 0007 instant_withdrawal

---

## 1. Secrets & credentials (do first)

- ☐ **Rotate every secret ever pasted in chat or committed history**
  - Tatum mainnet API key (assume burned) · Supabase DB password · `ADMIN_API_SECRET`
- ☐ Confirm `.env*` is gitignored and no secret is in git history.
- ☐ Store all secrets only in Vercel project env vars.
- ☑ Admin dashboard no longer uses a shared in-repo password — credential is
      scrypt-hashed in the DB and changed from the Admin Profile page (change the
      default `CheqPayAdmin!2026` on first login).

## 2. Deployment pipeline

- ☑ Web + API deploy via GitHub Actions (`deploy-vercel.yml`) — currently green.
- ☑ Admin deploys as its own project (`cheqpay-admin`, root `apps/admin`).
- ☐ Delete any leftover duplicate Vercel projects that auto-deploy.
- ☐ Set env on **`cheqpay-admin`**: `ADMIN_API_SECRET` (matches API),
      `ADMIN_DASHBOARD_SECRET`, `SUPABASE_URL` + anon key; then redeploy and log in.
- ☐ Set `CRON_SECRET` on the API project (gates the price-alert cron).
- ☐ Consider Vercel Pro (Hobby caps crons at once/day and 100 deploys/day).

## 3. Provider integrations — move OFF mock

- ☐ **Custody (Tatum)**: `CUSTODY_PROVIDER=tatum` + fresh `TATUM_API_KEY` /
      `TATUM_WEBHOOK_SECRET`. Verify wallet creation, deposit webhook, withdrawal.
- ☐ **Payments (Flutterwave)**: `PAYMENT_PROVIDER=flutterwave` +
      `FLUTTERWAVE_SECRET_KEY` + `FLUTTERWAVE_WEBHOOK_HASH`. Verify NGN deposit,
      payout, and bill payments against the live Bills API.
- ☐ **KYC (Dojah)**: `KYC_PROVIDER=dojah` + `DOJAH_APP_ID` / `DOJAH_API_KEY`
      (enable BVN). Verify auto-approve to tier 2; mismatches → admin review queue.
- ☐ **Price feed**: confirm `PRICE_FEED=live` reachable from Vercel.
- ☐ Set business rate + spread in admin **Trading Settings**.

## 4. Email / OTP delivery (Supabase)

- ☐ Enable **Email OTP** + email signups (Auth → Providers → Email).
- ☐ Set **OTP length = 6** (or the app accepts up to 10 either way).
- ☐ Paste the branded templates (Auth → Emails → Templates); keep `{{ .Token }}`
      (code) — no `{{ .ConfirmationURL }}` so users get a code, not a magic link.
- ☐ **Configure custom SMTP** (Resend/SendGrid/SES) + raise rate limits — the
      built-in email won't deliver OTPs to real users.
- ☐ Set Site URL + Redirect URLs to the live web app.

## 5. Money-safety & security review

- ☐ Set **`RELAX_WITHDRAWAL_GUARDS=false`** in prod (enforce MFA + KYC-tier gates).
- ☑ MFA enrolment flow exists (Profile → Security → 2-step authentication).
- ☑ Per-user "instant withdrawal" opt-out of 2FA (audited).
- ☐ Re-confirm idempotency keys + webhook signature verification on money endpoints.
- ☐ Verify atomic debit/refund paths (insufficient funds, provider failure).
- ☐ Run `/security-review` over the diff; address findings.
- ☐ Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on the API so account
      deletion also removes the Supabase auth user.

## 6. Data & reliability

- ☑ Prisma migrations 0001–0007 applied to prod.
- ☐ Supabase: enable Point-in-Time Recovery / backups.
- ☐ Use the Supabase **pooler** URL (6543, pgbouncer) in prod.
- ☐ Add error monitoring (e.g. Sentry) on web + api.
- ☐ `/api/health` + uptime monitor.

## 7. Compliance & legal

- ☐ Replace placeholder contact details in Support/Contact pages.
- ☐ Privacy Policy / Terms / AML reviewed by counsel; canonical Privacy URL.
- ☐ KYC/AML tier gating + sanctions screening confirmed with real data.
- ☐ Crypto + remittance licensing posture for Nigeria.

## 8. Mobile / Play Store packaging

- ☐ Set a real EAS `projectId` in `app.json` (real push tokens).
- ☐ EAS dev/production build (native modules: biometrics, alternate app icons,
      expo-print, push — none work in Expo Go).
- ☐ Custom production domain + HTTPS; PWA installability / TWA `assetlinks.json`.
- ☐ Play Console listing, data-safety, content rating, privacy URL, target API.

## 9. Pre-launch QA (production, small real amounts)

- ☐ Sign up → KYC → deposit NGN → buy BTC → sell BTC → balance updates.
- ☐ Convert BTC↔USDT; receive + send crypto; pay each bill type.
- ☐ 2FA enrol + withdraw with MFA; app lock; delete account.
- ☐ Admin: log in, analytics, trading settings, users/transactions, KYC review.

---

## 10. Future features (post-launch backlog)

- ☐ **NFC tap-to-share (native only)** — share a wallet address by tapping phones /
      an NFC card (`react-native-nfc-manager` + `react-native-hce`, Android-only for
      share; QR fallback for iOS). Needs an EAS build + physical device.

---

### Owner notes
- Code-side items I can do: main-only deploy workflow, `/api/health` + monitoring
  wiring, TWA/assetlinks, QA fixes.
- Dashboard/keys/legal (yours): rotate secrets, provider keys + env vars, Supabase
  email/SMTP config, legal review, Play Console.
