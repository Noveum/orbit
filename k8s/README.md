# Deploying Orbit

Orbit runs in the `orbit` namespace of an EKS cluster in `us-east-1`.
Everything needed to deploy it lives in this repository: the manifests here, the
Dockerfiles beside each app, and `buildspec.yml` at the root.

This is a public repository, so no manifest contains an account id, ARN,
hostname or address. Those are resolved from your AWS credentials at apply time
by `apply.sh`, which substitutes the `__PLACEHOLDER__` values before piping the
result to `kubectl`. Keep it that way when you edit these files.

## What runs where

| Piece | Where |
|---|---|
| `orbit-web` | Next.js standalone server, 2 to 6 pods, port 3000 |
| `orbit-realtime` | WebSocket fan-out, 2 pods, port 3100 |
| `orbit-mcp` | MCP over streamable HTTP, 1 pod, port 3200 |
| `orbit-redis` | Single StatefulSet in this namespace, 8Gi gp3 |
| Postgres | Its own small RDS instance, not in the cluster |
| Uploads | A private S3 bucket, reached with the pod role, never static keys |
| Ingress | Joins the existing shared ALB, one hostname |

All three services sit behind one hostname: `/ws` goes to realtime, `/mcp` goes
to mcp, everything else goes to web.

## Reaching the cluster

The EKS endpoint is private, so `kubectl` only works from inside the VPC or
through the bastion. Find the bastion first:

```
BASTION=$(aws ec2 describe-instances --region us-east-1 \
  --filters 'Name=tag:Name,Values=*Bastion*' 'Name=instance-state-name,Values=running' \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
```

The bastion already runs `kubectl proxy --port=8080`, so the quickest route is a
plain port forward. The proxy authenticates on the bastion side, so no local
credentials are involved:

```
ssh -i <your-key.pem> -f -N -L 8080:127.0.0.1:8080 ubuntu@"$BASTION"
export KUBE_SERVER=http://127.0.0.1:8080
kubectl --server=$KUBE_SERVER get pods -n orbit
```

`apply.sh` and `migrate.sh` both honour `KUBE_SERVER`. If the proxy is not
running, fall back to a SOCKS tunnel, which routes your own credentials instead:

```
ssh -i <your-key.pem> -f -N -D 1080 ubuntu@"$BASTION"
export HTTPS_PROXY=socks5://127.0.0.1:1080
```

The SOCKS route is slower, and note the AWS CLI cannot speak SOCKS, which is why
both scripts strip the proxy variables around their AWS lookups. The key is not
in this repository and must not be.

## First deploy

1. Create the namespace, service account and Redis, then check the rest renders
   correctly before touching the cluster:

```
./k8s/apply.sh --render        # print the resolved manifests, change nothing
./k8s/apply.sh --dry-run       # server side dry run
./k8s/apply.sh                 # apply for real
```

2. Load the RDS certificate authority. RDS runs with `rds.force_ssl=1`, and its
   certificate is signed by an Amazon CA that Node does not trust by default.
   Every workload mounts this bundle and points `NODE_EXTRA_CA_CERTS` at it, so
   the connection is both encrypted and verified:

```
curl -sO https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem
kubectl create configmap orbit-rds-ca -n orbit \
  --from-file=us-east-1-bundle.pem --dry-run=client -o yaml | kubectl apply -f -
```

Keeping the bundle in a ConfigMap rather than baking it into the images means
rotating it is an apply, not a rebuild. `DATABASE_URL` must end with
`?sslmode=verify-full`. Do not use `sslmode=require`: in pg-connection-string
2.x that is an alias for verify-full anyway, and it is documented to change
meaning in the next major version.

3. Create the two secrets the pods read. `REDIS_PASSWORD` must be the same value
   that appears inside `REDIS_URL` in Doppler:

```
kubectl create secret generic orbit-redis -n orbit \
  --from-literal=REDIS_PASSWORD="$(openssl rand -base64 24)"

kubectl create secret generic orbit-doppler-token -n orbit \
  --from-literal=DOPPLER_TOKEN='<doppler service token for orbit/prd>'
```

4. Point DNS at the load balancer. This is a manual step. The cluster runs
   external-dns with the AWS provider against an account that holds no Route53
   zone, so it will never create this record, and DNS is authoritative
   elsewhere. Read the load balancer hostname:

```
kubectl get ingress orbit-web -n orbit -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

Then add a single CNAME from the Orbit hostname to that value, proxying
disabled, matching how the other load-balancer-backed host in this zone is set
up. Proxying is off for every record in the zone today; turning it on for Orbit
alone would put a CDN in front of the WebSocket endpoint and require the origin
TLS mode to be full rather than flexible.

The certificate is already valid for this name: the ALB serves a wildcard ACM
certificate covering the zone, so nothing needs issuing.

5. Create the schema:

```
./k8s/migrate.sh
```

## Storage

Uploads go to a private S3 bucket. There is one storage path and no local disk
fallback, so development points the same S3 driver at the minio container from
`docker-compose.yml` and production points it at the real bucket.

Pods reach S3 through IRSA rather than static keys. The `orbit-app` service
account carries an `eks.amazonaws.com/role-arn` annotation, the role trusts the
cluster OIDC provider for exactly `system:serviceaccount:orbit:orbit-app`, and
it is scoped to get, put and delete inside the one bucket. Leave
`S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` unset in production so the SDK
picks up that role. Setting only one of the pair is rejected at startup.

The bucket blocks all public access. The browser uploads straight to a presigned
URL, so the bucket needs a CORS rule allowing `PUT` from the Orbit origin.
Downloads stay behind the app's permission check, which then redirects to a
short-lived presigned URL with the content type and disposition pinned.

## Doppler

Every pod starts as `doppler run -- <process>`, so all runtime configuration
comes from the `orbit` Doppler project, `prd` config. The web image also needs
Doppler at build time because Next.js inlines `NEXT_PUBLIC_*` values into the
client bundle, so `DOPPLER_TOKEN_BUILD` is read from Secrets Manager by
`buildspec.yml`.

At minimum the `prd` config needs:

```
DATABASE_URL              postgres://<user>:<password>@<rds-endpoint>:5432/orbit
REDIS_URL                 redis://:<password>@orbit-redis.orbit.svc.cluster.local:6379
BETTER_AUTH_SECRET        32+ random characters
BETTER_AUTH_URL           https://<orbit host>
NEXT_PUBLIC_APP_URL       https://<orbit host>
NEXT_PUBLIC_REALTIME_URL  wss://<orbit host>/ws
S3_BUCKET                 the uploads bucket name
S3_REGION                 us-east-1
RESEND_API_KEY            from Resend
EMAIL_FROM                a sender on a domain verified in Resend
```

`RESEND_API_KEY` and `EMAIL_FROM` are not optional. Passwords are disabled and
magic link is the way in, so without working email nobody can sign in at all. A
passkey only helps once an account already exists.

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET` are genuinely optional. Each pair enables that social
button only when both halves are present, and the callback to register with the
provider is `https://<orbit host>/api/auth/callback/<provider>`.

Never set `ORBIT_DEV_LOGIN` in the `prd` config. It bypasses the magic link.

The RDS master password is generated and rotated by AWS. Read it with:

```
aws secretsmanager get-secret-value --region us-east-1 \
  --secret-id "$(aws rds describe-db-instances --region us-east-1 \
    --db-instance-identifier orbit-prod-postgresql-rds \
    --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text)" \
  --query SecretString --output text
```

## Continuous deployment

A CodeBuild project runs `buildspec.yml` on every push to `main`. It builds four
images, pushes them to ECR tagged with the short commit, then `kubectl set
image` on the three deployments and waits for the rollouts. It runs inside the
VPC, which is the only reason it can reach the private EKS endpoint and RDS.

CodeBuild never applies these manifests. The deployments must already exist, and
the build fails loudly if they do not. Schema changes are never automatic: run
`migrate.sh` yourself when the schema moves.

## Sharing the ALB

These ingresses join an existing ALB group rather than creating a second load
balancer. Two consequences worth remembering:

- `group.order` values 11, 12 and 13 belong to Orbit, and the existing ingresses
  in that group use lower numbers. Do not reuse a number, the controller rejects
  duplicates within a group.
- Nothing here sets a load-balancer-level attribute. Those are shared across the
  whole group, so setting one would fight with the other ingresses and could
  disrupt an unrelated production host. Keep Orbit's annotations to target-group
  scope only.

The shared ALB idle timeout is 120s. The realtime server heartbeats every 30s,
comfortably inside that, so WebSockets stay up without changes.

## Everyday commands

```
kubectl get pods -n orbit
kubectl logs -n orbit -l app.kubernetes.io/name=orbit-web --tail=100 -f
kubectl rollout restart deployment/orbit-web -n orbit
kubectl rollout status deployment/orbit-web -n orbit
```
