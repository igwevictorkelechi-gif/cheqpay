# Changelog

All notable changes to the Cheqpay rebrand are documented here.

## [Unreleased] — branch `claude/cheq-pay-rebrand-kjehub`

### Real backend (Supabase) + email/password login
- Web Supabase client now points at the real `cheqpay` project by
  default (anon key is a public client key; env vars still override).
- Added **email + password sign-in** to the web login page and auth
  service (`signInWithEmail`), alongside the demo button.
- Added `supabase/seed_demo_user.sql` to seed a real demo account
  (profile, wallet, static virtual account, sample transactions) and the
  RLS read policies.
- NOTE: the anon key default is a placeholder pending the real key; real
  login activates once it is filled in `apps/web/src/services/supabase.ts`.

### Demo user
- **"Continue as demo user"** on the login screen (web + mobile) seeds a
  sample account (Victor Igwe, ₦152,340.50 balance, a Wema virtual
  account and sample transactions) into the stores and opens the app —
  so the live deploy is fully explorable without a Supabase backend.
- Web transactions page keeps the seeded demo transactions instead of
  overwriting them with an empty backend fetch.

### Profile / Account hub
- **Profile page** (web `/profile`, mobile `(app)/profile`) opened by
  tapping the **avatar** in the home/crypto/pay-bill top bar: identity
  (avatar, name, @handle), feature cards (Join Cheqpay Tribe / Need
  help?), and a menu — Account, Recipients, Connected bank accounts,
  Security, Preferences, About us — plus **Log out** and app version.
- `TopBar` now accepts an avatar tap handler on both apps.

### Deposit / Add money (Flutterwave static account)
- **Deposit flow** on web (`/deposit` → `/deposit/transfer` → `/deposit/done`)
  and mobile (`(app)/deposit` → `deposit-transfer` → `deposit-done`):
  enter amount + Bank Transfer option → static account transfer
  instructions (amount to send, account number with copy, bank, account
  name, deposit fee, you will receive, deposit terms) → "All done"
  success with the recommended savings card.
- **Flutterwave integration:** new server route
  `/api/flutterwave/virtual-account` creates a *static* (permanent)
  virtual account via Flutterwave when `FLUTTERWAVE_SECRET_KEY` is set,
  with a deterministic mock fallback so the flow works without keys.
  Mobile calls this route through `services/deposit.ts`.
- Home **Deposit** action now opens this flow (was a no-op / fund-wallet).

### Swap flow (Convert → Confirm → Success)
- **Swap confirmation page** (web `/convert/confirm`, mobile
  `(app)/swap-confirm`): pay/receive legs, rate, network fee and
  estimated time, a "Confirm Swap" button with a processing state, and
  Cancel. Reached from "Preview Swap".
- **Swap success page** (web `/convert/success`, mobile
  `(app)/swap-success`): success check, swap summary and a
  **"View transaction history"** button (plus Done). Reached after a
  swap is confirmed.
- Amounts/symbols flow through the screens via route params; shared
  `CoinBadge` added to the web UI kit.

### Convert / Swap + navigation
- **New Convert (crypto swap) page** on web (`/convert`) and mobile
  (`(app)/convert`): SOURCE/TOKEN asset cards (BTC → ETH) with a brand
  swap toggle, on-screen numeric keypad, live amount + mock conversion
  rate, and a "Preview Swap" CTA.
- Wired the **Convert** quick-action (Home) and **Trade** action (Crypto)
  to the new page on both apps.
- **Removed the web side navigation.** `MainLayout` (used by send,
  withdraw, settings, transactions, kyc) now renders the phone-shaped
  shell with the **bottom tab bar** only; `Sidebar`/`Header` are no
  longer used.
- Mobile: `convert` registered as a hidden (non-tab) route.

### Theme — dark + purple brand
- Brand colour set to **#6B5B95** (purple); apps moved to a **dark
  theme** (surface `#14121A`, cards `#1F1B29`, light text, muted
  lavender-grey, dark tab bars, light status bar).
- Pay Bill service tiles / country pill and Crypto positive amounts
  recoloured for dark mode; Nigerian flag pinned to green.

### Rebrand (Home / Crypto / Pay Bill)
- Rebuilt the app around three tabs — **Home, Crypto, Pay Bill** —
  matching the supplied designs, on both the Expo mobile app and the
  Next.js web app (shared mobile-style UI primitives + phone shell).

### Build & deploy
- Added `packages/shared/tsconfig.json` so the shared package emits
  `dist/` (it never built before).
- Supabase client falls back to placeholder credentials instead of
  throwing when env vars are absent.
- Updated wallet realtime subscriptions to the supabase-js v2 channel
  API; wrapped `verify-otp` `useSearchParams` in Suspense; fixed lint.
- Reworked `vercel.json` to build only `packages/shared` + `apps/web`
  (install via bun); added a GitHub Actions workflow
  (`.github/workflows/deploy-vercel.yml`) that deploys to the `cheqpy`
  Vercel project from CI (needs the `VERCEL_TOKEN` repo secret).
- Live at **https://cheqpy.vercel.app**.
