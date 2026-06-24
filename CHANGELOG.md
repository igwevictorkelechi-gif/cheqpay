# Changelog

All notable changes to the Cheqpay rebrand are documented here.

## [Unreleased] — branch `claude/cheq-pay-rebrand-kjehub`

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
