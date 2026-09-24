# Object storage endpoint configuration

Orbit stores file bytes in S3-compatible object storage and file metadata in
PostgreSQL. Back up both stores. A database backup alone does not preserve
attachments or uploaded documents.

Set `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` for a
provider with explicit credentials. Set `S3_ENDPOINT` for a custom S3 endpoint.
AWS deployments can omit explicit credentials and use an ambient IAM role.

`S3_FORCE_PATH_STYLE` accepts `true` or `false`. When it is unset or empty,
custom endpoints retain path-style addressing and AWS retains virtual-hosted
addressing. Invalid values fail validation rather than silently selecting a mode.

| Provider | Endpoint style | Setting |
| --- | --- | --- |
| Docker preview MinIO | `endpoint/bucket/key` | Unset or `true` |
| New Railway storage buckets | `bucket.endpoint/key` | `false` |
| AWS S3 without a custom endpoint | AWS virtual-hosted URL | Unset |

Use the base endpoint from the provider, without the bucket name. Railway's
bucket variables map to Orbit's settings as follows:

```env
S3_BUCKET=${{Bucket.BUCKET}}
S3_REGION=${{Bucket.REGION}}
S3_ENDPOINT=${{Bucket.ENDPOINT}}
S3_ACCESS_KEY_ID=${{Bucket.ACCESS_KEY_ID}}
S3_SECRET_ACCESS_KEY=${{Bucket.SECRET_ACCESS_KEY}}
S3_FORCE_PATH_STYLE=false
```

`Bucket` is the Railway bucket's service name. Existing Railway buckets can use
a different addressing style; follow the bucket's Credentials tab. See the
[Railway storage documentation](https://docs.railway.com/storage-buckets).

Keep the bucket private. Configure its CORS policy to permit browser uploads
from the application's actual origin, then test an authenticated upload,
download, access denial and persistence after restart. Addressing support alone
does not establish that a provider template is ready for production.
