# CheqPay — Nigerian NGN ⇄ Crypto Custodial Wallet

An NGN ⇄ crypto (BTC + USDT) custodial wallet with a dedicated backend. Users
fund with Naira through a dedicated **Maplerad** virtual account (NUBAN), buy,
sell and convert crypto at live rates, send and receive on-chain, pay bills, and
complete KYC — from a web app, a native mobile app, and an admin dashboard.

## Project structure

```
cheqpay/
├── apps/
│   ├── mobile/          # React Native + Expo (iOS/Android)
│   ├── web/             # Next.js 15 user app (dark PWA, phone → desktop)
│   ├── admin/           # Next.js 15 admin dashboard (+ its own API proxy layer)
│   └── api/             # Next.js 15 custodial backend — the money engine
├── packages/
│   ├── db/              # Prisma schema + migrations (Supabase Postgres)
│   └── shared/          # Shared types and schemas
└── supabase/            # Migrations and seed SQL
```

Managed with **bun workspaces + Turborepo**. The user apps talk to `apps/api`
over HTTPS; auth tokens come from Supabase Auth.

| App | Platform | Purpose | Stack |
|-----|----------|---------|-------|
| **Mobile** | iOS/Android | Wallet, crypto, bills, KYC | React Native + Expo |
| **Web** | Browser | The same product as a PWA | Next.js 15 + Tailwind |
| **Admin** | Browser | KYC review, settings, users, logos | Next.js 15 |
| **API** | Serverless | Ledger, swaps, payouts, webhooks | Next.js 15 + Prisma |

## Tech stack

**Backend (`apps/api`) — the custodial money engine**
- Next.js 15 route handlers, serverless on Vercel
- Prisma on Supabase Postgres. **Money is BigInt minor units — never floats**
- Supabase Auth token validation; MFA (AAL2) gating on withdrawals
- Swappable providers behind interfaces: payments, custody, price feed, KYC
- Idempotency keys, webhook signature verification, AML screening, rate limits,
  append-only audit log

**Clients** — React Native + Expo Router + NativeWind (mobile); Next.js 15 App
Router + Tailwind + Zustand (web and admin). TypeScript throughout.

### Provider integrations

`mock` is the default everywhere, so a fresh checkout never calls a third party.

| Concern | Provider | Covers |
|---|---|---|
| Payments | **Maplerad** | NGN virtual accounts (collections), bank payouts, bill payments, name enquiry |
| Custody | **Maplerad** | Stablecoin wallets and addresses |
| Price feed | Binance / CoinGecko | BTC and USDT spot |
| KYC | Dojah | BVN lookup + name match |

Maplerad is the only live money provider. Flutterwave, Paystack and Tatum were
removed — if you find them referenced anywhere, that reference is stale.

> **Maplerad requires IP whitelisting, and Vercel has no static outbound IP.**
> Production therefore routes Maplerad calls through a fixed-IP egress proxy via
> `MAPLERAD_BASE_URL`, with a shared secret in `X-Proxy-Secret`. Both Maplerad
> clients (`lib/maplerad/client.ts` and `payments/maplerad.ts`) send that header.
> Verified: the same key refused from an un-whitelisted IP succeeds through the
> proxy. See `.github/workflows/verify-maplerad-proxy.yml`.

#### Outbound Maplerad endpoints, checked against the published contract

Every Maplerad call we make, audited field by field against Maplerad's OpenAPI
definitions. This table records what was *read from the contract*, not what was
executed — a ✅ means our request and response handling match the published
schema, not that the call has been run against a funded live account.

| Endpoint | Used by | State |
|---|---|---|
| `POST /identity/bvn` | KYC name match | ✅ |
| `POST /customers` | Customer creation (tier 0) | ✅ |
| `PATCH /customers/upgrade/tier1` | Tier 1 upgrade | ✅ |
| `PATCH /customers/upgrade/tier2` | — | Contract recorded, no caller (needs document upload) |
| `POST /collections/virtual-account` | NGN deposit account | ✅ Fixed — sent an unaccepted `reference`, read a `bank_code` never returned |
| `POST /crypto` | Deposit addresses | ✅ (`offramp`, not `off_ramp`; coin enum is **upper**-case) |
| `POST /crypto/transfer` | Stablecoin withdrawal | ⚠️ See below — coin enum is **lower**-case; chain enum is `solana` only |
| `GET /institutions` | Bank lists | ✅ Fixed — paginates; one page was silently dropping the tail |
| `POST /institutions/resolve` | Name enquiry | ✅ Fixed — sent an undocumented `currency`. Returns a dummy name in sandbox |
| `POST /institutions/fetch` | — | ✅, no caller |
| `POST /transfers` | NGN payouts | ✅ — documented 200 body carries no `id`, so we fall back to our own reference |
| `GET /bills/{type}/billers/{country}` | Biller discovery | ✅ |
| `GET /bills/airtime/billers/{country}` | Airtime billers | ⚠️ See below |
| `GET /bills/{bill_type}/bundle/{biller}` | Data bundles | ✅ |
| `POST /bills/data` · `/airtime` · `/cable` · `/electricity` | Bill payment | ✅ |

Two open items, both flagged in the code at the point where they matter:

**Stablecoin withdrawals are disabled, deliberately.** `POST /crypto` mints
addresses on six chains; `POST /crypto/transfer` documents Solana as its only
destination. Both pairs we ship (USDT and USDC, ERC-20) are therefore one-way on
paper: money could arrive at an address with no documented route out. Rather than
hand users an address we might not be able to empty, `custody/maplerad.ts`
refuses to mint one until the chain is confirmed withdrawable. Nothing observable
changes today — address creation is broken on Maplerad's side anyway — but the
trap cannot open the moment they fix it. To lift it, run one sandbox withdrawal
and set `withdrawable: true`, or move the pairs to Solana.

**Airtime biller identifiers are unverified.** `lib/bills.ts` sends per-network
identifiers (`mtn-ng`, `airtel-ng`, …); Maplerad's documented example returns a
single country-level `ng-airtime`. An example is not a full list, so this is
genuinely open. `provider-check`'s "Airtime billers" probe prints every
identifier Maplerad returns — one read-only call settles it.

## Core features

- **NGN wallet** — fund via a dedicated Maplerad NUBAN; withdraw to any
  Nigerian bank
- **Crypto (BTC + USDT)** — buy, sell and convert (including BTC↔USDT) at live
  rates with an admin-controlled spread; receive (QR + address) and send
  on-chain
- **Bill payments** — airtime, data, electricity, cable TV and betting, with
  brand tiles whose logos are uploaded from admin
- **Transfers between users** — send to another CheqPay user by username
- **Cashback** — configurable reward credited on qualifying transactions
- **Statements** — CSV and PDF, emailed on request
- **One custodial ledger** — a single transaction history behind every screen

Transaction types: `DEPOSIT`, `WITHDRAWAL`, `BUY`, `SELL`, `CONVERT`, `BILL`,
`CASHBACK`, `TRANSFER_OUT`, `TRANSFER_IN`.

## KYC, and what it unlocks

Tiers gate limits and crypto withdrawals (Tier 0 unverified → Tier 3 premium).

Submitting **BVN + matching name** auto-approves via the KYC provider. Anything
that does not auto-verify lands in the admin **KYC Review** queue.

The order of what happens on `POST /api/kyc` matters, and is deliberate:

1. Verify the identity with the KYC provider and record the verdict
2. Persist the identity fields; the **BVN is retained encrypted** so it can be
   produced again without asking the user to retype it
3. **Enrol the user as a Maplerad customer** — needs BVN, date of birth, phone
   and address
4. **Then** open the permanent NGN deposit account

Step 4 depends on step 3: a Maplerad collection account hangs off a customer id.
Enrolling second meant every account request went out without one and failed, so
nobody ever received an account number. Steps 3 and 4 are best-effort — a
provider hiccup must not fail verification, and the deposit screen re-provisions
on demand.

Deposits are then credited by the `collection.*` webhook, which matches the
NUBAN to its owner and credits the ledger idempotently.

The KYC form must collect **phone and address**, not just BVN and name.
Without them enrolment is skipped, and without enrolment there is no account
number.

## API reference

63 routes in `apps/api`. Every one is verified to exist, load and enforce its
guard — see [Testing](#testing). Everything not marked public requires a
Supabase bearer token; admin routes require the admin secret.

**Health and configuration (public)**

| Route | Methods |
|---|---|
| `/api/health` | GET |
| `/api/ready` | GET |
| `/api/features` | GET |
| `/api/popup` | GET |
| `/api/support/contact` | GET |
| `/api/market/[asset]/price` | GET |
| `/api/market/[asset]/chart` | GET |

**Identity, KYC and account**

| Route | Methods |
|---|---|
| `/api/me` | GET, POST, PATCH, DELETE |
| `/api/kyc` | GET, POST |
| `/api/users/lookup` | GET |
| `/api/notifications/preferences` | GET, PATCH |
| `/api/push/register` | POST, DELETE |
| `/api/security/instant-withdrawal` | POST |
| `/api/statements/request` | GET, POST |
| `/api/support/chat` | POST |

**Money in**

| Route | Methods |
|---|---|
| `/api/virtual-accounts` | GET, POST |
| `/api/wallets` | GET, POST |
| `/api/balances` | GET |
| `/api/crypto/deposit-addresses` | GET |

**Money out**

| Route | Methods |
|---|---|
| `/api/withdrawals/ngn` | POST |
| `/api/withdrawals/crypto` | POST |
| `/api/banks` | GET |
| `/api/banks/resolve` | POST |
| `/api/beneficiaries` | GET, POST |
| `/api/beneficiaries/[id]` | DELETE |

**Trading, bills, transfers, cards, history**

| Route | Methods |
|---|---|
| `/api/quotes` | POST |
| `/api/quotes/convert` | POST |
| `/api/swaps` | POST |
| `/api/bills/catalog` | GET |
| `/api/bills/validate` | POST |
| `/api/bills/pay` | POST |
| `/api/transfers` | POST |
| `/api/cards` | GET, POST |
| `/api/cards/[id]` | GET |
| `/api/transactions` | GET |
| `/api/transactions/[id]` | GET |

**Called by machines, not by the apps**

| Route | Methods | Caller |
|---|---|---|
| `/api/webhooks/maplerad` | POST | Maplerad (signature verified) |
| `/api/cron/price-alerts` | GET | Vercel cron, `apps/api/vercel.json` |

**Admin — 25 routes, all behind the admin secret**

`adjust-balance`, `analytics`, `bills/logo`, `bills/logos`, `credentials`,
`credit-crypto`, `crypto-wallets`, `features`, `kyc`, `login`, `otp`, `popup`,
`provider-check`, `provider-status`, `roles`, `security/activity`, `settings`,
`stats`, `subjects/lookup`, `support-contact`, `transactions`, `users`,
`users/[id]`, `virtual-accounts`, `withdrawals`.

The admin dashboard never calls these directly. It has its own route layer at
`apps/admin/app/api/*` that proxies each one server-side, so `ADMIN_API_SECRET`
stays out of the browser.

`GET /api/admin/provider-check` is the one to reach for when money stops
moving: it makes read-only calls to Maplerad and reports, per probe, whether the
key is valid, whether this deployment's IP is whitelisted, whether collections
are enabled, and whether there is float. It exercises **both** Maplerad clients.

## Setup

**See [INSTALL.md](./INSTALL.md)** for tools, environment files and running all
four apps.

```bash
bun install
bunx prisma generate --schema packages/db/prisma/schema.prisma
cd apps/api && bun run dev          # then web, admin, mobile
```

Migrations are **not** applied on deploy. Idempotent `ensure*` helpers run at
boot from `apps/api/src/instrumentation.ts` instead.

## Testing

```bash
bun run test          # 188 tests
bun run build         # api, web, admin (mobile builds through EAS)
bun run lint
```

Two checks worth knowing about, both of which have caught real bugs that
typechecking and unit tests could not:

**Every route exists and guards itself.** Boot the API and probe all 63 routes
unauthenticated. A `401` proves the route loaded and refused an anonymous
caller; a `404` would mean the route is missing. No database is needed —
authentication is checked before any Prisma call.

```bash
cd apps/api && ADMIN_API_SECRET=<16+ chars> bunx next dev -p 4399
curl -i http://localhost:4399/api/health          # 200
curl -i -X POST http://localhost:4399/api/kyc     # 401, not 404
```

**Every client call resolves to a real route.** API paths are strings, so a call
to a route that was renamed or never existed compiles and ships. Both bugs found
that way were client calls into routes that had never existed, each wrapped in a
`try/catch` that swallowed the 404 — so the UI looked like it worked.

**Responsive layout.** `apps/web` is checked by driving a real browser over the
built app at seven viewport sizes from 360px portrait to 1920px, asserting no
horizontal overflow and that the desktop sidebar appears only where it should.
That is how a 256px overflow on every `AppShell` page was found.

## Deployment

| Target | Where |
|---|---|
| API | Vercel project `cheqpay-admin453` → `cheqpay-admin453.vercel.app` |
| Web | Vercel project `cheqpy` |
| Admin | Vercel project `cheqpay-admin` |
| Mobile | EAS (`eas build --platform ios` / `android`) |

`.github/workflows/deploy-vercel.yml` deploys web and API to **production** on
every push to `main` or the active feature branch.

`mycheqpay.com` is served from a **static export**, not from Vercel:

```bash
cd apps/web && STATIC_EXPORT=1 bun run build   # emits out/
```

Upload `out/` to the web host. Every page is client-rendered and talks to the
API over HTTPS, so the host only ever serves files — no Node, no PHP, no
database. See [apps/web/STATIC-HOSTING.md](./apps/web/STATIC-HOSTING.md).
**A change is not live on `mycheqpay.com` until a fresh export is uploaded.**

## Database

Prisma models: `User`, `UserSession`, `RetainedSubject`, `Beneficiary`, `Card`,
`Wallet`, `Balance`, `Quote`, `Transaction`, `KycRecord`, `WebhookEvent`,
`PlatformSetting`, `AuditLog`, `BillerAsset`.

`packages/db/prisma/schema.prisma` is the source of truth — read it rather than
a copy in a README, which is how the previous one came to describe tables that
no longer existed.

Balances are BigInt minor units. `WebhookEvent` carries a unique `eventId` that
makes replay a no-op.

## Security

- Provider secret keys are server-only and never reach a client bundle
- `ADMIN_API_SECRET` stays server-side; the admin browser talks to its own proxy
- Row-level security on Supabase; users see only their own rows
- Withdrawals require MFA at AAL2
- BVN and other PII are encrypted at rest with `PII_ENCRYPTION_KEY`
- Webhook signatures are verified before any state change
- Append-only audit log on every privileged action

## License

Intended to be MIT. There is no LICENSE file in the repository yet — the
previous README pointed at one that has never existed. Add it before treating
the project as licensed.

## Support

- Email: support@cheqpay.com
