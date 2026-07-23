#!/usr/bin/env sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"

AWS_REGION="${AWS_REGION:-us-east-1}"

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

JOB=$(sed "s|__ECR_REGISTRY__|${ECR_REGISTRY}|g" "$HERE/06-migrate-job.yaml" \
  | kube create -f - -o name)
echo "created $JOB"

kube wait --for=jsonpath='{.status.ready}'=1 "$JOB" -n orbit --timeout=120s >/dev/null 2>&1 || true
kube logs -n orbit "$JOB" --follow --tail=-1 || true

if kube wait --for=condition=complete --timeout=180s "$JOB" -n orbit >/dev/null 2>&1; then
  echo "schema is up to date"
  exit 0
fi
echo "migration did not succeed, inspect with: kubectl describe $JOB -n orbit" >&2
exit 1
