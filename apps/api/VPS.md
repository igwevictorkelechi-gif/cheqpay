# Running the CheqPay API on a self-managed VPS

An alternative to [RENDER.md](./RENDER.md). Both solve the same problem — a
**static outbound IP** for Maplerad's whitelist, which Vercel's serverless
functions cannot provide. Pick one; this document assumes you chose the VPS.

Only `apps/api` moves. The web app (`cheqpy`) and admin dashboard
(`cheqpay-admin`) stay on Vercel.

## Choosing the box

### Region

Three latencies compete, and the answer is not obvious:

| Server location | → users (NG) | → Maplerad (Lagos) | → Supabase (`eu-west-1`, Ireland) |
|---|---|---|---|
| Lagos | ~5 ms | ~5 ms | ~100 ms |
| Frankfurt / Ireland | ~120 ms | ~120 ms | ~20 ms |
| US (e.g. Phoenix) | ~200 ms | ~200 ms | ~150 ms |

The database leg is paid **per query**, the user leg **per request**, so the
deciding factor is how many queries an average request makes. For this API, one:

| Endpoint | Queries |
|---|---|
| `/api/wallets`, `/api/balances`, `/api/transactions` | 1 each |
| `/api/transfers` (worst case, the money path) | 4 sequential |

At one query per request a Lagos server is *faster overall* than a European one
(~110 ms vs ~140 ms round trip), because the single database hop costs less than
the user hop it saves. Europe only wins on `/api/transfers` — which is also the
path that calls Maplerad, where Lagos wins the time straight back.

**So: Lagos or Europe are both defensible; a US data centre is not.** Lagos also
means one static IP to whitelist and, on a Nigerian host, naira billing. Choose
Europe if you would rather keep the API next to the database and accept the
user-latency hit.

If you later move Supabase to a region nearer the server, do it while the
dataset is small — it is a project once there is real customer money in the
ledger. Note there is no West-Africa Supabase region, so a Lagos server is
permanently ~100 ms from its database whatever you do.

### Spec

Minimum sensible: **2 vCPU, 4 GB RAM, 40 GB SSD**. The image is built in CI
rather than on the server, so you are sizing for the runtime, not for
`next build`.

Do not go below 2 GB. Next plus the Prisma client plus Caddy will fit, but an
OOM kill on a payments API is downtime, and the headroom is cheap.

## Architecture

```
GitHub Actions ──build──> GHCR (ghcr.io/<owner>/cheqpay-api:<sha>)
                                    │
                              ssh + docker pull
                                    ▼
       Internet ──443──> Caddy ──> api container ──> Supabase (eu-west-1)
                        (TLS)      (Next, port 4000)
```

The server never builds. CI produces an immutable `:<sha>` tag; the server pulls
and runs it. That keeps the box small, makes deploys atomic, and makes rollback
a matter of naming the previous tag.

| File | Role |
|---|---|
| `apps/api/Dockerfile` | The image. Identical to the Render path — nothing here is host-specific. |
| `deploy/docker-compose.yml` | The two services: api + Caddy. |
| `deploy/Caddyfile` | TLS termination and reverse proxy. |
| `deploy/deploy.sh` | Health-gated rollout. Lives at `/opt/cheqpay/deploy.sh`. |
| `.github/workflows/deploy-vps.yml` | Build → push → SSH deploy. **Manual trigger only** until cutover. |

---

## Step 1 — Prepare the server

As root on a fresh Ubuntu 22.04/24.04 box:

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# A non-root deploy user with docker access
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy

# Firewall: SSH + HTTP + HTTPS, nothing else. The API is NOT exposed
# directly — only Caddy binds a public port.
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable

# Unattended security updates: this box is now yours to patch.
apt-get install -y unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades
```

Add your CI public key to `/home/deploy/.ssh/authorized_keys`. Generate the pair
with `ssh-keygen -t ed25519 -C "cheqpay-ci" -f cheqpay_ci -N ""`; the **private**
half becomes the `VPS_SSH_KEY` secret.

## Step 2 — Point DNS at it

An `A` record for `api.cheqpay.com` → the server's IP. Caddy needs this resolving
**before** it starts, or ACME cannot issue a certificate.

## Step 3 — Install the deploy files

```bash
mkdir -p /opt/cheqpay && chown deploy:deploy /opt/cheqpay
# From your machine, in the repo root:
scp deploy/docker-compose.yml deploy/Caddyfile deploy/deploy.sh \
    deploy@<host>:/opt/cheqpay/
ssh deploy@<host> chmod +x /opt/cheqpay/deploy.sh
```

## Step 4 — Secrets

Create `/opt/cheqpay/.env` on the server. **Never commit this.**

```bash
ssh deploy@<host>
touch /opt/cheqpay/.env && chmod 600 /opt/cheqpay/.env
nano /opt/cheqpay/.env
```

Copy every variable from the Vercel project `cheqpay-admin453` → Settings →
Environment Variables, plus:

```ini
API_DOMAIN=api.cheqpay.com          # Caddy uses this for the certificate
API_PUBLIC_URL=https://api.cheqpay.com
```

The essentials — see `apps/api/src/lib/env.ts` for the full set and defaults:

| Key | Notes |
|---|---|
| `DATABASE_URL` | Supabase pooled (6543, `?pgbouncer=true`) |
| `DIRECT_URL` | Supabase direct (5432) |
| `SUPABASE_JWT_SECRET` | Verifies client tokens |
| `ADMIN_API_SECRET` | Must match the admin Vercel project |
| `ADMIN_EMAILS` | Admin allowlist |
| `MAPLERAD_SECRET_KEY` | The reason this server exists |
| `MAPLERAD_WEBHOOK_SECRET` | Svix `whsec_…` |
| `RESEND_API_KEY`, `MAIL_FROM` | Both blank keeps email dark rather than half-working |
| `CRON_SECRET` | Gates `/api/cron/*` — needed for Step 7 |

`RELAX_WITHDRAWAL_GUARDS` must stay unset. It disables the MFA and KYC gates on
crypto withdrawals.

## Step 5 — Registry credentials

The image is private by default. Give the server a **read-only** pull token —
a classic PAT with `read:packages` only, not your personal token with write
scope:

```bash
echo "<PAT>" | docker login ghcr.io -u <github-username> --password-stdin
```

Alternatively make the package public in GitHub → Packages → Package settings.
The image contains your built application code, so weigh that.

## Step 6 — First deploy

Push the image and roll it out: GitHub → Actions → **Deploy API to VPS** → Run
workflow. Then:

```bash
curl https://api.cheqpay.com/api/health
# {"status":"ok","service":"cheqpay-api",...}
```

If Caddy fails to get a certificate, `docker compose logs caddy` will say why —
almost always DNS not yet resolving, or port 80 blocked.

## Step 7 — The cron job

Vercel Cron does not follow the API off Vercel. `apps/api/vercel.json` schedules
`/api/cron/price-alerts` daily at 08:00 UTC; without re-creating it, price alerts
silently stop firing. On the server, as `deploy`:

```bash
crontab -e
```

```cron
# CheqPay price alerts — 08:00 UTC daily, matching the old Vercel schedule.
0 8 * * * cd /opt/cheqpay && docker compose run --rm --no-deps api bun run cron:price-alerts >> /var/log/cheqpay-cron.log 2>&1
```

The script calls the running service over HTTP with the bearer header the route
expects, and exits non-zero on failure, so a broken job shows up in that log
rather than passing silently.

## Step 8 — Whitelist the outbound IP

A VPS has exactly one outbound IP: the server's own address. Add it to
Maplerad's IP whitelist, and point their webhook at:

```
https://api.cheqpay.com/api/webhooks/maplerad
```

This is the one place a VPS is genuinely simpler than Render, which rotates
between three egress addresses that all have to be whitelisted.

## Step 9 — Cut the clients over

Nothing has changed for users until this step.

| Client | Where | Variable |
|---|---|---|
| Admin (`cheqpay-admin`) | Vercel env | `CHEQPAY_API_URL` |
| Web (`cheqpy`) | Vercel env | `NEXT_PUBLIC_API_URL` |
| Mobile | `apps/mobile/.env` → new EAS build | `EXPO_PUBLIC_API_URL` |

Each falls back to `https://cheqpay-admin453.vercel.app` when unset, so the order
is: set, redeploy, verify. The fallback is a safety net, not a plan.

Mobile is the slow one — `EXPO_PUBLIC_*` is inlined at build time, so installed
apps keep calling Vercel until users update. **Leave the Vercel deployment
running** until the new build has rolled out.

> Once the server is serving, **[GO-LIVE.md](./GO-LIVE.md)** is the sequence for
> switching Maplerad to live and turning the feature flags on one at a time.

## Step 10 — Decommission

Only once Step 9 is verified *and* the mobile build has rolled out:

1. Change `.github/workflows/deploy-vps.yml` to trigger on `push: branches: [main]`.
2. Delete the `deploy-api` job from `.github/workflows/deploy-vercel.yml`.
3. Pause or delete the `cheqpay-admin453` Vercel project.

Until then Vercel is your rollback and costs nothing extra.

---

## Operating it

**Rollback.** Every deploy is tagged with a commit SHA:

```bash
IMAGE_TAG=<previous-sha> /opt/cheqpay/deploy.sh
```

**Logs.**

```bash
docker compose -f /opt/cheqpay/docker-compose.yml logs -f --tail 100 api
```

Both services cap log files at 20 MB × 5. Without that the daemon eventually
fills the disk, and on a full disk *every* write fails, including the database
driver's.

**Restarts.** `restart: unless-stopped` brings containers back after a crash or
a reboot. The health check catches a process that is running but not serving.

**What you have taken on.** This is the honest cost of leaving a managed
platform: OS patching, certificate renewal (Caddy automates it, but the volume
must survive), disk and memory monitoring, and the fact that this is a single
box with no failover. If it dies at 2 a.m., nothing brings it back but you.

**Deploys are not zero-downtime.** `docker compose up -d` recreates the
container, so there is a few-second gap. Acceptable for a low-traffic launch,
but be aware a request in flight during a deploy will fail. If that becomes
unacceptable, the next step is running two API replicas behind Caddy and
draining one at a time — worth doing only once transaction volume justifies it.

**Backups.** Nothing here holds state — the database is Supabase's and is backed
up there (Pro plan required for daily backups). The one exception is the
`caddy_data` volume, which holds your TLS certificates. Losing it means
re-issuing, and Let's Encrypt rate-limits duplicates. Do not `docker volume
prune` on this box.
