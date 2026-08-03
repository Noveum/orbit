# Infrastructure

Orbit deploys as a single Vercel project, so the only thing left here is the
bucket policy the browser needs.

`s3-cors.json` is the CORS document for the uploads bucket. Uploads go straight
from the browser to object storage through a presigned PUT, so the bucket has to
allow that origin, method and header. Apply it after changing it, replacing the
placeholder with the real origin:

```sh
sed 's|__ORBIT_ORIGIN__|https://orbit.example.com|' infra/s3-cors.json > /tmp/cors.json
aws s3api put-bucket-cors --bucket "$S3_BUCKET" --cors-configuration file:///tmp/cors.json
```
