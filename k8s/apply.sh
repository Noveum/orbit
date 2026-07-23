#!/usr/bin/env sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"

AWS_REGION="${AWS_REGION:-us-east-1}"
ORBIT_HOST="${ORBIT_HOST:-orbit.noveum.ai}"
ALB_GROUP="${ALB_GROUP:-noveum-prod-alb}"
CERT_DOMAIN="${CERT_DOMAIN:-noveum.ai}"
S3_ROLE_NAME="${S3_ROLE_NAME:-Orbit-Prod-App-S3-Role}"

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "$1 is required but not installed" >&2; exit 1; }
}
require aws
require kubectl
require sed

awscli() {
  env -u HTTPS_PROXY -u https_proxy -u ALL_PROXY -u all_proxy aws "$@"
}

AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(awscli sts get-caller-identity --query Account --output text)}"
if [ -z "$AWS_ACCOUNT_ID" ] || [ "$AWS_ACCOUNT_ID" = "None" ]; then
  echo "Could not resolve the AWS account. Are your credentials loaded?" >&2
  exit 1
fi

covers_host() {
  CANDIDATE="$1"
  awscli acm describe-certificate --region "$AWS_REGION" --certificate-arn "$CANDIDATE" \
    --query 'Certificate.SubjectAlternativeNames[]' --output text 2>/dev/null \
    | tr '\t' '\n' \
    | while IFS= read -r NAME; do
        [ -z "$NAME" ] && continue
        [ "$NAME" = "$ORBIT_HOST" ] && { echo match; break; }
        case "$NAME" in
          \*.*)
            SUFFIX="${NAME#\*}"
            STEM="${ORBIT_HOST%"$SUFFIX"}"
            case "$ORBIT_HOST" in
              *"$SUFFIX")
                case "$STEM" in *.*) ;; *) echo match; break;; esac
                ;;
            esac
            ;;
        esac
      done
}

if [ -z "${ACM_CERTIFICATE_ARN:-}" ]; then
  for CANDIDATE in $(awscli acm list-certificates --region "$AWS_REGION" \
      --certificate-statuses ISSUED \
      --query 'CertificateSummaryList[].CertificateArn' --output text | tr '\t' '\n'); do
    if [ -n "$(covers_host "$CANDIDATE")" ]; then
      ACM_CERTIFICATE_ARN="$CANDIDATE"
      break
    fi
  done
fi
if [ -z "${ACM_CERTIFICATE_ARN:-}" ] || [ "$ACM_CERTIFICATE_ARN" = "None" ]; then
  echo "No ISSUED ACM certificate in ${AWS_REGION} covers ${ORBIT_HOST}." >&2
  echo "Set ACM_CERTIFICATE_ARN explicitly to override." >&2
  exit 1
fi

ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
ORBIT_S3_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${S3_ROLE_NAME}"

echo "region     ${AWS_REGION}"
echo "host       ${ORBIT_HOST}"
echo "alb group  ${ALB_GROUP}"
echo "registry   ${ECR_REGISTRY}"

render() {
  sed \
    -e "s|__ECR_REGISTRY__|${ECR_REGISTRY}|g" \
    -e "s|__ORBIT_S3_ROLE_ARN__|${ORBIT_S3_ROLE_ARN}|g" \
    -e "s|__ACM_CERTIFICATE_ARN__|${ACM_CERTIFICATE_ARN}|g" \
    -e "s|__ORBIT_HOST__|${ORBIT_HOST}|g" \
    -e "s|__ALB_GROUP__|${ALB_GROUP}|g" \
    "$1"
}

MANIFESTS="00-namespace.yaml 01-redis.yaml 02-web.yaml 03-realtime.yaml 04-mcp.yaml 05-ingress.yaml"

if [ "${1:-}" = "--render" ]; then
  for file in $MANIFESTS; do render "$HERE/$file"; echo "---"; done
  exit 0
fi

KUBECTL_ARGS=""
if [ -n "${KUBE_SERVER:-}" ]; then
  KUBECTL_ARGS="--server=${KUBE_SERVER}"
fi
if [ "${1:-}" = "--dry-run" ]; then
  KUBECTL_ARGS="$KUBECTL_ARGS --dry-run=server"
  echo "running a server side dry run, nothing will be changed"
fi

for file in $MANIFESTS; do
  echo "applying $file"
  render "$HERE/$file" | kubectl apply $KUBECTL_ARGS -f -
done

echo "done. run the migrate job separately with:"
echo "  k8s/migrate.sh"
