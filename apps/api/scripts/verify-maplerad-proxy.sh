#!/usr/bin/env bash
#
# Does routing Maplerad through a fixed-IP proxy actually satisfy their IP
# whitelist? Runs the proxied case and the direct case back to back, because a
# proxied success only means something if the direct call fails — otherwise the
# whitelist is not being enforced and the result proves nothing.
#
# Read-only throughout: provider-check lists banks, wallets and billers. Nothing
# here creates an account, enrolls a customer or moves money.
#
# Usage, from the repo root:
#
#   export MAPLERAD_SECRET_KEY=<SANDBOX key>          # never the live key
#   export MAPLERAD_PROXY_SECRET=<PROXY_SHARED_SECRET on the Node app>
#   export MAPLERAD_PROXY_URL=https://maplerad-proxy.mycheqpay.com
#   ./apps/api/scripts/verify-maplerad-proxy.sh
#
# No database is needed. provider-check never touches Prisma, and requireAdmin
# accepts a service secret before it reaches any DB path, so DATABASE_URL is
# deliberately not set here — a verification run should not be able to see
# production data at all.

set -uo pipefail

PORT="${PORT:-4123}"
PROXY_URL="${MAPLERAD_PROXY_URL:-https://maplerad-proxy.mycheqpay.com}"
API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Generated per run and never persisted: this only has to be consistent between
# the server and the curl below.
ADMIN_SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)"

die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
note() { printf '\n\033[1m%s\033[0m\n' "$*"; }

[ -n "${MAPLERAD_SECRET_KEY:-}" ]   || die "MAPLERAD_SECRET_KEY is not set. Use the SANDBOX key — the proxy terminates TLS on shared hosting, so whatever goes through it is readable there."
[ -n "${MAPLERAD_PROXY_SECRET:-}" ] || die "MAPLERAD_PROXY_SECRET is not set. It must equal PROXY_SHARED_SECRET on the Node app."

pretty() { if command -v jq >/dev/null 2>&1; then jq .; else python3 -m json.tool 2>/dev/null || cat; fi; }

# ---------------------------------------------------------------- step 2 ----
note "1/4  Proxy reachable, and closed to callers without the secret"

health=$(curl -sS -m 20 "$PROXY_URL/__health" 2>&1)
echo "  /__health            -> $health"
case "$health" in
  *'"ok":true'*) ;;
  *) die "The proxy did not report healthy. Everything after this would fail for the wrong reason — fix the proxy first." ;;
esac

unauth=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "$PROXY_URL/institutions" 2>&1)
echo "  /institutions (bare) -> $unauth  (want 404: open proxies get found and abused)"
[ "$unauth" = "404" ] || printf '\033[33m  WARNING: expected 404 without the secret. The proxy may be open to anyone who finds the URL.\033[0m\n'

egress=$(curl -sS -m 20 -H "X-Proxy-Secret: $MAPLERAD_PROXY_SECRET" "$PROXY_URL/__egress" 2>&1)
echo "  /__egress            -> $egress"
case "$egress" in
  *egressIp*) ;;
  *) die "The secret was not accepted, so the proxy is rejecting us rather than Maplerad. Make MAPLERAD_PROXY_SECRET match PROXY_SHARED_SECRET on the Node app, then re-run. Without this the next steps 404 and it looks like an IP problem." ;;
esac
echo "  ^ this is the IP that must be whitelisted in the Maplerad dashboard"

# ------------------------------------------------------------- steps 3-5 ----
# $1 = label, $2 = MAPLERAD_BASE_URL ("" means call Maplerad directly)
run_case() {
  local label="$1" base="$2" out
  out="$(mktemp)"

  ( cd "$API_DIR" \
      && MAPLERAD_SECRET_KEY="$MAPLERAD_SECRET_KEY" \
         MAPLERAD_PROXY_SECRET="$MAPLERAD_PROXY_SECRET" \
         ADMIN_API_SECRET="$ADMIN_SECRET" \
         PAYMENT_PROVIDER=maplerad \
         CUSTODY_PROVIDER=maplerad \
         ${base:+MAPLERAD_BASE_URL="$base"} \
         bun run dev -- -p "$PORT" >"$out" 2>&1 ) &
  local pid=$!

  # The base URL is read at module load, so the server must be restarted
  # between cases rather than reconfigured. Wait for it to actually answer.
  local i
  for i in $(seq 1 60); do
    curl -sS -m 2 -o /dev/null "http://localhost:$PORT/api/health" 2>/dev/null && break
    sleep 1
  done

  curl -sS -m 90 -H "x-admin-secret: $ADMIN_SECRET" \
    "http://localhost:$PORT/api/admin/provider-check" 2>&1 | pretty

  kill "$pid" 2>/dev/null
  pkill -f "next dev -p $PORT" 2>/dev/null
  wait "$pid" 2>/dev/null
  rm -f "$out"
  sleep 2
}

note "2/4  PROXIED — MAPLERAD_BASE_URL=$PROXY_URL"
run_case proxied "$PROXY_URL"

note "3/4  DIRECT (the control) — this machine's IP, which is NOT whitelisted"
echo "     If this also passes, the whitelist is not being enforced and the"
echo "     proxied result proves nothing."
run_case direct ""

note "4/4  How to read it"
cat <<'EOF'
  proxied passes + direct 403   A fixed IP satisfies Maplerad. The approach works.
  both 403                      IP not accepted yet. Check the /__egress address
                                above is actually saved in the Maplerad dashboard.
  both pass                     No whitelist in force — the premise needs rechecking.
  401 anywhere                  IP is fine, the key is wrong or rotated.
  404 on every probe            The proxy is rejecting us, not Maplerad. Secrets differ.
  "No VIRTUAL institutions"     IP and key are fine; collections are not enabled on
                                the business. That is a request to Maplerad.

  Note on coverage: provider-check exercises lib/maplerad/client.ts only. The
  second client, payments/maplerad.ts, sends the same header but is not touched
  by these probes — it is what bills, transfers and virtual accounts use.
EOF
