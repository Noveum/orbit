# syntax=docker/dockerfile:1.7
ARG DEPS_IMAGE=orbit-deps:build

FROM oven/bun:1.3.14-alpine AS base
ENV CI=1
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM ${DEPS_IMAGE} AS deps

FROM deps AS installer
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
RUN --mount=type=secret,id=DOPPLER_TOKEN,required=false \
    --mount=type=cache,target=/app/apps/web/.next/cache \
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
COPY --from=deps /usr/bin/doppler /usr/bin/doppler
COPY --from=installer --chown=orbit:orbit /app/apps/web/.next/standalone ./
COPY --from=installer --chown=orbit:orbit /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=installer --chown=orbit:orbit /app/apps/web/public ./apps/web/public
USER orbit
EXPOSE 3000
CMD ["/usr/bin/doppler", "run", "--", "bun", "apps/web/server.js"]
