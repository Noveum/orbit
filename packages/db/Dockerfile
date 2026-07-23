# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3.14-alpine AS base
ENV CI=1
WORKDIR /app

FROM base AS doppler
RUN apk add --no-cache wget && \
    wget -q -t3 'https://packages.doppler.com/public/cli/rsa.8004D9FF50437357.key' -O /etc/apk/keys/cli@doppler-8004D9FF50437357.rsa.pub && \
    echo 'https://packages.doppler.com/public/cli/alpine/any-version/main' >> /etc/apk/repositories && \
    apk add --no-cache doppler

FROM base AS runner
RUN addgroup -S orbit && adduser -S orbit -G orbit
COPY --from=doppler /usr/bin/doppler /usr/bin/doppler
COPY --chown=orbit:orbit package.json bun.lock ./
COPY --chown=orbit:orbit apps/mcp/package.json apps/mcp/package.json
COPY --chown=orbit:orbit apps/realtime/package.json apps/realtime/package.json
COPY --chown=orbit:orbit apps/web/package.json apps/web/package.json
COPY --chown=orbit:orbit packages/core/package.json packages/core/package.json
COPY --chown=orbit:orbit packages/db/package.json packages/db/package.json
COPY --chown=orbit:orbit packages/realtime-client/package.json packages/realtime-client/package.json
COPY --chown=orbit:orbit packages/services/package.json packages/services/package.json
COPY --chown=orbit:orbit packages/shared/package.json packages/shared/package.json
RUN test -s bun.lock || (echo "bun.lock is missing, refusing to build a floating dependency tree" >&2; exit 1)
RUN bun install --frozen-lockfile
COPY --chown=orbit:orbit tsconfig.base.json ./
COPY --chown=orbit:orbit packages packages
RUN chown -R orbit:orbit /app
USER orbit
WORKDIR /app/packages/db
CMD ["/usr/bin/doppler", "run", "--", "bun", "run", "push"]
