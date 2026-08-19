# CheqPay — installing and running locally

Everything you need to go from a fresh clone to all four apps running. Written
for someone joining the project who has never seen it before.

> **This supersedes the setup section in [README.md](./README.md)**, which is out
> of date — it predates the move to bun, Prisma and Maplerad, and will not work.

**Expect about 20 minutes**, most of it waiting for installs.

---

## 1. Tools

| Tool | Version | Why |
|---|---|---|
| **bun** | 1.3+ | Package manager **and** runner. The lockfile is `bun.lock`; npm and yarn will not work. |
| **Node.js** | 20+ | Next.js and some tooling still need it, even though bun runs the scripts. |
| **Git** | any | — |
| Expo Go app | latest | Only if you want the mobile app on a real phone. |

```bash
curl -fsSL https://bun.sh/install | bash   # macOS / Linux / WSL
bun --version                              # expect 1.3 or newer
```

**Do not run `npm install`.** This is a bun workspace. npm will resolve a
different dependency tree, ignore `bun.lock`, and produce failures that look
like code bugs.

## 2. Clone and install

```bash
git clone https://github.com/igwevictorkelechi-gif/cheqpay.git
cd cheqpay
bun install
```

One install at the repo root covers all six workspaces — `apps/api`, `apps/web`,
`apps/admin`, `apps/mobile`, `packages/db`, `packages/shared`. You never install
inside an app directory.

## 3. Generate the database client

```bash
bunx prisma generate --schema packages/db/prisma/schema.prisma
```

**Do this before anything else runs.** `@cheqpay/db` exports a Prisma client
that does not exist until it is generated, so every app that imports it fails
with a confusing module error until you have.

Re-run it whenever `packages/db/prisma/schema.prisma` changes — including after
pulling someone else's branch.

## 4. Environment files

Each app reads its own. Copy the examples, then fill in the values:

```bash
cp apps/api/.env.example    apps/api/.env
cp apps/web/.env.example    apps/web/.env.local
cp apps/admin/.env.example  apps/admin/.env.local
cp apps/mobile/.env.example apps/mobile/.env
```

### What you actually need to get started

You do **not** need payment or crypto credentials to run locally. The providers
default to `mock`, which is deliberate: it means a new developer can work on the
whole app without touching real money or waiting for provider access.

The minimum is a database and auth:

| Variable | App | Where it comes from |
|---|---|---|
| `DATABASE_URL` | api | Supabase → Settings → Database → Connection string (pooled, port 6543) |
| `DIRECT_URL` | api | Same page, direct connection (port 5432) |
| `SUPABASE_JWT_SECRET` | api | Supabase → Settings → API → JWT Secret |
| `NEXT_PUBLIC_SUPABASE_URL` | web | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | Same page → anon/public key |
| `NEXT_PUBLIC_API_URL` | web | `http://localhost:4000` |
| `CHEQPAY_API_URL` | admin | `http://localhost:4000` |
| `ADMIN_API_SECRET` | admin **and** api | Any random 16+ char string — **the same value in both**, or the dashboard cannot talk to the API |
| `EXPO_PUBLIC_API_URL` | mobile | Your machine's LAN IP, e.g. `http://192.168.1.5:4000` — see §6 |

Ask whoever runs the project for the shared development Supabase credentials
rather than creating your own project; the schema lives there already.

### Secrets that must never be committed

`.env`, `.env.local` and `.env*` are gitignored. Keep it that way. In particular
`SUPABASE_SERVICE_ROLE_KEY` and `PII_ENCRYPTION_KEY` bypass every access control
in the system — never paste them into a client app, a chat, or a ticket.

## 5. Run it

Four apps, four terminals. **Start the API first** — the others call it.

```bash
# Terminal 1 — API            http://localhost:4000
cd apps/api && bun run dev

# Terminal 2 — Web app        http://localhost:3000
cd apps/web && bun run dev

# Terminal 3 — Admin          http://localhost:3001
cd apps/admin && bun run dev -- -p 3001

# Terminal 4 — Mobile
cd apps/mobile && bun run dev
```

**The `-p 3001` on admin is not optional.** Both Next apps default to port 3000,
so whichever starts second either fails or silently moves — and then the admin
dashboard's proxy calls go to the wrong place.

Check the API is alive before debugging anything else:

```bash
curl http://localhost:4000/api/health
# {"status":"ok","service":"cheqpay-api",...}
```

`bun run dev` at the repo root starts everything at once via Turborepo, but the
interleaved output makes failures hard to read. Separate terminals are worth it
until you know the project.

## 6. Mobile specifics

`localhost` on a phone means the phone, not your laptop. Set
`EXPO_PUBLIC_API_URL` to your machine's LAN address:

```bash
ipconfig getifaddr en0        # macOS
hostname -I | awk '{print $1}' # Linux
```

Then `EXPO_PUBLIC_API_URL=http://192.168.x.x:4000` in `apps/mobile/.env`, and
make sure the phone is on the same Wi-Fi.

**`EXPO_PUBLIC_*` values are baked in at bundle time.** Changing one means
restarting Expo with `bun run dev -- --clear`; without the flag the old value
stays in the Metro cache and you will chase a phantom.

## 7. Verify the install

```bash
bun run test          # 161 API tests — should pass with no database
bun run build         # builds every app
bunx tsc --noEmit     # typecheck (run inside an app directory)
```

The tests are pure unit tests and need no database or network, so a failure here
is a real problem rather than a missing environment variable.

---

## When it goes wrong

**`Cannot find module '@prisma/client'` or `@cheqpay/db` errors**
You skipped §3, or the schema changed since you last generated. Re-run
`bunx prisma generate --schema packages/db/prisma/schema.prisma`.

**`Module not found: @cheqpay/shared`**
That package is compiled — its `main` points at `dist/`. Run
`cd packages/shared && bun run build`.

**API starts, but every request 500s**
Almost always `DATABASE_URL`. Check it is the **pooled** connection (port 6543)
with `?pgbouncer=true`, not the direct one.

**Admin dashboard pages are blank**
`CHEQPAY_API_URL` is wrong, or `ADMIN_API_SECRET` differs between the admin and
api env files. The pages fail silently because the proxy returns an error the UI
does not surface.

**Web app shows a blank dark screen**
Missing `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The auth
guard renders nothing until it can check for a session.

**Mobile cannot reach the API**
LAN IP wrong, phone on a different network, or a firewall blocking port 4000.
Test from the phone's browser: `http://192.168.x.x:4000/api/health`.

**Anything weird after switching branches**
```bash
rm -rf node_modules apps/*/.next && bun install
bunx prisma generate --schema packages/db/prisma/schema.prisma
```

---

## Where things live

| Path | What |
|---|---|
| `apps/api` | The money engine. Next.js route handlers, Prisma, all provider integrations. |
| `apps/web` | Customer web app. Every page is client-rendered. |
| `apps/admin` | Internal dashboard. Proxies to the API; never talks to the database. |
| `apps/mobile` | Expo / React Native app. |
| `packages/db` | Prisma schema and client. The single source of truth for the data model. |
| `packages/shared` | Types and helpers shared across apps. Compiled to `dist/`. |

## Things worth knowing before you change anything

**Money is always integers.** Amounts are `BigInt` in minor units — kobo for
NGN, satoshis for BTC. Use `toMinorUnits` / `fromMinorUnits` in
`apps/api/src/lib/money.ts`. Never a float, anywhere, for any reason.

**Migrations are not applied on deploy.** Newer tables and columns are created by
idempotent `ensure*` helpers that run at boot (see
`apps/api/src/instrumentation.ts`). If you add a column to a Prisma model you
**must** add it to the matching helper — Prisma names every model column in every
query, so a column that exists in the schema but not the database breaks every
query on that table.

**Features are behind flags.** `platform_settings.feature_flags` gates deposits,
withdrawals, bills, cards and transfers. Several default OFF for real reasons —
see `apps/api/src/lib/features.ts` before switching one on.

**Providers default to `mock`.** Setting `PAYMENT_PROVIDER=maplerad` locally will
attempt real API calls with real consequences. Leave it alone unless you mean it.

## Related docs

| Doc | For |
|---|---|
| [apps/api/GO-LIVE.md](./apps/api/GO-LIVE.md) | Switching to live Maplerad, in order |
| [apps/api/VPS.md](./apps/api/VPS.md) | Running the API on a self-managed server |
| [apps/api/RENDER.md](./apps/api/RENDER.md) | Running the API on Render |
| [apps/web/STATIC-HOSTING.md](./apps/web/STATIC-HOSTING.md) | Serving the web app from cPanel hosting |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | How the pieces fit together |
