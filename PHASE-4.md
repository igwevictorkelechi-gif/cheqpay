# Phase 4 — Swap engine + market-data feed

Server-issued quotes and atomic buy/sell against treasury inventory, plus the
live price/chart feed for the asset detail page. The **admin-set spread + rate**
from Phase 1 is where the business margin is applied. Mock-first and fully tested.

## Market-data feed (asset page) — `src/market`
- `PriceFeed` interface — `getSpotUsdt`, `getCandles(range)`. **Display only**;
  separate from execution pricing.
- `BinancePriceFeed` (primary) — `/ticker/price` + `/klines` candles.
- `CoinGeckoPriceFeed` (fallback) — `/simple/price` + `/market_chart`.
- `CachedFallbackFeed` — tries primary, falls back on error, **caches**
  (spot ~15s, candles ~120s) to respect rate limits.
- `MockPriceFeed` — deterministic, for tests (`PRICE_FEED=mock`).
- Endpoints (auth-gated, proxied so the app never calls exchanges directly):
  - `GET /api/market/:asset/price` → `{ priceUsd, priceNgn }` (NGN via business rate)
  - `GET /api/market/:asset/chart?range=day|week|month|year|all` → candles

## Quote engine — `src/lib/rates.ts`
- `mid NGN/crypto = (crypto/USDT price) × (business USDT→NGN rate)`.
- Spread applied directionally: **buy = mid × (1+s)**, **sell = mid × (1−s)**.
- Decimal math (Prisma.Decimal), then **floor to integer minor units** — never
  over-credits the user. No floats in stored money.

## Swap flow — `src/lib/swap.ts`
- `POST /api/quotes` — issues a `Quote` (TTL 45s) with `amountIn/amountOut/rate`;
  enforces the tier single-tx limit on the NGN leg. **Client never sets the rate.**
- `POST /api/swaps` (Idempotency-Key) — executes a quote **atomically**:
  consume quote (first-writer-wins) → debit from-asset (refuses overdraw) →
  credit to-asset → record BUY/SELL transaction (links quote) → audit log.
  Rejects expired/consumed/foreign quotes; idempotent on replay.

## Execution model (v1)
Treasury / inventory: swaps move the user's ledger balances at the quoted rate;
the business holds the crypto + NGN float off-ledger and rebalances (ops). No
live order routing. A dedicated treasury ledger account can be added later if you
want on-ledger float tracking.

## Tested (`vitest`, 59 passing total; +13 this phase)
- Quote math: buy/sell, spread direction, USDT (price=1), floor/dust, both
  assets — exact expected minor-unit values.
- Market parsers: Binance ticker/klines, CoinGecko price/chart, mock feed.
- (vitest now resolves the `@/` path alias.)
- `next build` clean — 13 API routes.

## Notes
- Asset page design showed ETH; launch wires **BTC + USDT**. The feed/quote code
  is asset-driven, so ETH is a small addition when you expand.
- DB-touching swap execution is built + unit-tested at the pure-logic layer;
  full integration tests need a live DB.

## Next: Phase 5 — Withdrawals & limits (crypto)
Crypto withdrawal via custody-provider signing, per-tx + daily limits, 2FA for
crypto withdrawals, confirmation thresholds on deposits. **Awaiting go-ahead.**
