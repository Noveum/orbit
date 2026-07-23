#!/usr/bin/env sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"

AWS_REGION="${AWS_REGION:-us-east-1}"
JOB_TIMEOUT="${JOB_TIMEOUT:-600}"

awscli() {
  env -u HTTPS_PROXY -u https_proxy -u ALL_PROXY -u all_proxy aws "$@"
}

kube() {
  if [ -n "${KUBE_SERVER:-}" ]; then
    kubectl --server="$KUBE_SERVER" "$@"
  else
    kubectl "$@"
  fi
}

AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(awscli sts get-caller-identity --query Account --output text)}"
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

if [ -z "${IMAGE_TAG:-}" ]; then
  RUNNING=$(kube get deployment orbit-web -n orbit \
    -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)
  IMAGE_TAG="${RUNNING##*:}"
fi
if [ -z "$IMAGE_TAG" ] || [ "$IMAGE_TAG" = "latest" ]; then
  echo "Refusing to migrate from a mutable tag." >&2
  echo "orbit-web must run an immutable tag, or set IMAGE_TAG explicitly." >&2
  exit 1
fi
echo "migrating with image tag $IMAGE_TAG (matching orbit-web)"

JOB=$(sed -e "s|__ECR_REGISTRY__|${ECR_REGISTRY}|g" -e "s|__IMAGE_TAG__|${IMAGE_TAG}|g" \
  "$HERE/06-migrate-job.yaml" | kube create -f - -o name)
echo "created $JOB"

kube logs -n orbit "$JOB" --follow --tail=-1 &
LOGS_PID=$!

STATUS=0
kube wait --for=condition=complete --timeout="${JOB_TIMEOUT}s" "$JOB" -n orbit >/dev/null 2>&1 || STATUS=1

kill "$LOGS_PID" 2>/dev/null || true
wait "$LOGS_PID" 2>/dev/null || true

if [ "$STATUS" -eq 0 ]; then
  echo "schema is up to date"
  exit 0
fi
echo "migration did not complete within ${JOB_TIMEOUT}s." >&2
echo "inspect with: kubectl describe $JOB -n orbit" >&2
exit 1
