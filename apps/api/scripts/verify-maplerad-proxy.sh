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
# env.ts enforces a 16-character minimum, and a shorter value fails env
# validation with a bare 500 whose real cause only appears in the server log —
# which would look exactly like the provider call failing. Refuse to run rather
# than hand back that confusion.
[ "${#ADMIN_SECRET}" -ge 16 ] || die "Could not generate an admin secret of at least 16 characters (got ${#ADMIN_SECRET}). Is /dev/urandom readable?"

die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
note() { printf '\n\033[1m%s\033[0m\n' "$*"; }

[ -n "${MAPLERAD_SECRET_KEY:-}" ]   || die "MAPLERAD_SECRET_KEY is not set. Use the SANDBOX key — the proxy terminates TLS on shared hosting, so whatever goes through it is readable there."
[ -n "${MAPLERAD_PROXY_SECRET:-}" ] || die "MAPLERAD_PROXY_SECRET is not set. It must equal PROXY_SHARED_SECRET on the Node app."

# Print JSON readably, but never swallow non-JSON. An earlier version piped
# straight into jq, so when the server had not started the only thing reported
# was "jq: parse error" — which says nothing about what actually went wrong.
pretty() {
  local body
  body="$(cat)"
  if printf '%s' "$body" | python3 -m json.tool 2>/dev/null; then
    return 0
  fi
  printf '\033[33m  Not JSON. Raw response:\033[0m\n%s\n' "$body"
}

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

# The control has to differ from the proxied case in ONE way: the egress IP. So
# the direct call goes to whatever host the proxy itself forwards to, rather
# than to a hardcoded default that might not be the same host.
UPSTREAM="$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("upstream",""))' 2>/dev/null)"
UPSTREAM="${UPSTREAM:-https://api.maplerad.com/v1}"
echo "  upstream             -> $UPSTREAM  (the control will call this directly)"

# A sandbox key sent to the live host is rejected with 401 no matter whose IP it
# comes from, which would look exactly like a whitelist failure and is not one.
# Compare modes from the key PREFIX only — the key itself is never printed.
key_prefix="$(printf '%s' "$MAPLERAD_SECRET_KEY" | cut -c1-8)"
case "$key_prefix:$UPSTREAM" in
  *test*:*//api.maplerad.com*|*sandbox*:*//api.maplerad.com*)
    printf '\033[33m
  WARNING: the key looks like a TEST key (prefix "%s") but the proxy forwards to
  the LIVE host. Maplerad rejects that pairing with 401 regardless of source IP,
  so a 401 below would say nothing about the whitelist. Point the proxy upstream
  at the sandbox host, or read the 401 as inconclusive.\033[0m
' "$key_prefix"
    ;;
esac

# ------------------------------------------------------------- steps 3-5 ----
# $1 = label, $2 = MAPLERAD_BASE_URL, $3 = port
#
# Each case gets its OWN port. Sharing one port meant the second case lost the
# bind to a server that had not actually died — kill took the subshell while
# next-server carried on — and the readiness probe then cheerfully accepted the
# FIRST server's answer. The run printed the proxied result twice and labelled
# the copy "direct", which reads as "both pass, no whitelist in force". A wrong
# answer that looks like a real one is the worst thing this script can produce.
run_case() {
  local label="$1" base="$2" port="$3" out
  out="$(mktemp)"

  if curl -sS -m 2 -o /dev/null "http://localhost:$port/api/health" 2>/dev/null; then
    printf '\033[31m  Port %s is already in use. Refusing to run the %s case: any result would come from a server this script did not configure.\033[0m\n' "$port" "$label"
    return
  fi

  # Export rather than use an assignment prefix. Bash decides what is an
  # assignment prefix while PARSING, before any expansion, so a prefix produced
  # by ${base:+...} is taken as the command name instead — the server never
  # started and the wait below then burned its full timeout on nothing.
  (
    cd "$API_DIR" || exit 1
    export MAPLERAD_SECRET_KEY MAPLERAD_PROXY_SECRET
    export ADMIN_API_SECRET="$ADMIN_SECRET"
    export PAYMENT_PROVIDER=maplerad
    export CUSTODY_PROVIDER=maplerad
    export MAPLERAD_BASE_URL="$base"
    bun run dev -- -p "$port" >"$out" 2>&1
  ) &
  local pid=$!

  # The base URL is read at module load, so the server must be restarted
  # between cases rather than reconfigured. Wait for it to actually answer.
  #
  # Generous on purpose: the FIRST case compiles Next from cold, which on a CI
  # runner takes well over a minute, while the second reuses that build and is
  # up in seconds. A 60s cap silently timed out the proxied case — the one that
  # actually matters — and left the direct control looking like the whole result.
  local i up="" waited=0
  for i in $(seq 1 240); do
    if curl -sS -m 2 -o /dev/null "http://localhost:$port/api/health" 2>/dev/null; then
      up=yes
      break
    fi
    # If the server process is already gone, waiting the rest of the timeout
    # tells us nothing — it just delays the real error by four minutes.
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    waited=$i
    sleep 1
  done

  if [ -z "$up" ]; then
    printf '\033[31m  The API never became ready (gave up after %ss). No result for this case.\033[0m\n' "$waited"
    printf '  Last lines of the server log:\n'
    tail -20 "$out" | sed 's/^/    /'
  else
    local body
    body="$(curl -sS -m 120 -H "x-admin-secret: $ADMIN_SECRET" \
      "http://localhost:$port/api/admin/provider-check" 2>&1)"
    printf '%s' "$body" | pretty

    # provider-check echoes the base URL it actually used. Insist it is the one
    # we asked for, so a result can never be silently attributed to the wrong
    # case. Without this the run above reported the proxied result as "direct".
    case "$body" in
      *"\"baseUrl\":\"$base\""*) ;;
      *) printf '\033[31m  MISMATCH: asked for base URL %s but the server reports something else. Discard this result — it did not come from the %s case.\033[0m\n' "$base" "$label" ;;
    esac
  fi

  # kill takes the subshell; next-server is a grandchild and survives it, which
  # is what let a dead case keep serving. Take the port itself.
  kill "$pid" 2>/dev/null
  { lsof -ti "tcp:$port" 2>/dev/null || true; } | xargs -r kill 2>/dev/null
  wait "$pid" 2>/dev/null
  rm -f "$out"
  sleep 2
}

note "2/4  PROXIED — MAPLERAD_BASE_URL=$PROXY_URL"
run_case proxied "$PROXY_URL" "$PORT"

note "3/4  DIRECT (the control) — same host, same key, this machine's un-whitelisted IP"
echo "     If this also passes, the whitelist is not being enforced and the"
echo "     proxied result proves nothing."
run_case direct "$UPSTREAM" "$((PORT + 1))"

note "4/4  How to read it"
cat <<'EOF'
  proxied passes + direct 403   A fixed IP satisfies Maplerad. The approach works.
  both 403                      IP not accepted yet. Check the /__egress address
                                above is actually saved in the Maplerad dashboard.
  both pass                     No whitelist in force — the premise needs rechecking.
  both 401                      Inconclusive about the IP. 401 is the key being
                                refused, and a test key sent to the live host is
                                refused from every IP. Check the mode warning above.
  proxied passes + direct 401   IP is what changed, so the fixed IP is doing the work.
  404 on every probe            The proxy is rejecting us, not Maplerad. Secrets differ.
  "No VIRTUAL institutions"     IP and key are fine; collections are not enabled on
                                the business. That is a request to Maplerad.

  Note on coverage: provider-check exercises lib/maplerad/client.ts only. The
  second client, payments/maplerad.ts, sends the same header but is not touched
  by these probes — it is what bills, transfers and virtual accounts use.
EOF
