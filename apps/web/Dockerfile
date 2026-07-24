# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3.14-alpine AS base
ENV CI=1
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS doppler
RUN apk add --no-cache wget && \
    wget -q -t3 'https://packages.doppler.com/public/cli/rsa.8004D9FF50437357.key' -O /etc/apk/keys/cli@doppler-8004D9FF50437357.rsa.pub && \
    echo 'https://packages.doppler.com/public/cli/alpine/any-version/main' >> /etc/apk/repositories && \
    apk add --no-cache doppler

FROM base AS deps
COPY package.json bun.lock ./
COPY apps/mcp/package.json apps/mcp/package.json
COPY apps/realtime/package.json apps/realtime/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/realtime-client/package.json packages/realtime-client/package.json
COPY packages/services/package.json packages/services/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN test -s bun.lock || (echo "bun.lock is missing, refusing to build a floating dependency tree" >&2; exit 1)
RUN bun install --frozen-lockfile

FROM deps AS installer
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
COPY --from=doppler /usr/bin/doppler /usr/bin/doppler
RUN --mount=type=secret,id=DOPPLER_TOKEN,required=false \
    set -eu; \
    if [ -s /run/secrets/DOPPLER_TOKEN ]; then \
      export DOPPLER_INTERACTIVE=false; \
      export DOPPLER_TOKEN="$(cat /run/secrets/DOPPLER_TOKEN)"; \
      doppler run -- bun run --filter '@orbit/web' build; \
    else \
      echo "No Doppler token supplied, building with placeholder configuration."; \
      echo "This image is only fit for build verification, never for deployment."; \
      DATABASE_URL="postgres://placeholder:placeholder@127.0.0.1:5432/placeholder" \
      BETTER_AUTH_SECRET="placeholder-secret-0123456789abcdef" \
      bun run --filter '@orbit/web' build; \
    fi

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -S orbit && adduser -S orbit -G orbit
COPY --from=doppler /usr/bin/doppler /usr/bin/doppler
COPY --from=installer --chown=orbit:orbit /app/apps/web/.next/standalone ./
COPY --from=installer --chown=orbit:orbit /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=installer --chown=orbit:orbit /app/apps/web/public ./apps/web/public
USER orbit
EXPOSE 3000
CMD ["/usr/bin/doppler", "run", "--", "bun", "apps/web/server.js"]
