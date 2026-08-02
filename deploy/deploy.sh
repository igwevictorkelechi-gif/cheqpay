#!/usr/bin/env bash
#
# Roll the API forward to a specific image tag, or abort without touching what
# is currently serving.
#
# Invoked over SSH by .github/workflows/deploy-vps.yml, and safe to run by hand:
#   IMAGE_TAG=<sha> /opt/cheqpay/deploy.sh
#
# The contract: this script either leaves a healthy container on the new tag, or
# leaves the previous one running and exits non-zero. It never leaves the API
# down on a bad deploy — which matters more here than on an ordinary web app,
# because a request that fails mid-payout is a support case, not a retry.

set -euo pipefail

APP_DIR=${APP_DIR:-/opt/cheqpay}
cd "$APP_DIR"

if [[ -z "${IMAGE_TAG:-}" ]]; then
  echo "IMAGE_TAG is required (the immutable commit-sha tag to deploy)." >&2
  exit 2
fi

# Record what is live now so a failed rollout can be reverted by hand.
PREVIOUS=$(docker compose ps -q api >/dev/null 2>&1 &&
  docker inspect --format '{{ index .Config.Image }}' "$(docker compose ps -q api)" 2>/dev/null || true)
echo "Currently running: ${PREVIOUS:-<nothing>}"
echo "Deploying tag:     $IMAGE_TAG"

export IMAGE_TAG

# Pull first. A registry outage or a bad tag must fail here, before anything
# serving is disturbed.
docker compose pull api

docker compose up -d api caddy

# Wait for the new container to report healthy. Compose returns as soon as the
# container is *started*, which is not the same as able to serve — without this
# wait a crash-looping image would be reported as a successful deploy.
echo -n "Waiting for health"
for _ in $(seq 1 30); do
  cid=$(docker compose ps -q api)
  state=$(docker inspect --format '{{ .State.Health.Status }}' "$cid" 2>/dev/null || echo starting)
  if [[ "$state" == "healthy" ]]; then
    echo " ok"
    # Reclaim disk from superseded images. Untagged only: never touch volumes,
    # which is where Caddy's certificates live.
    docker image prune -f >/dev/null || true
    echo "Deployed $IMAGE_TAG"
    exit 0
  fi
  if [[ "$state" == "unhealthy" ]]; then break; fi
  echo -n "."
  sleep 5
done

echo
echo "New image did not become healthy. Recent logs:" >&2
docker compose logs --tail 60 api >&2
echo >&2
echo "The previous image was: ${PREVIOUS:-<unknown>}" >&2
echo "Roll back with: IMAGE_TAG=<previous-sha> $APP_DIR/deploy.sh" >&2
exit 1
