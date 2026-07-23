# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PNPM_HOME/bin:$PATH"
ENV CI=1
ENV TURBO_TELEMETRY_DISABLED=1
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

FROM base AS doppler
RUN apk add --no-cache wget && \
    wget -q -t3 'https://packages.doppler.com/public/cli/rsa.8004D9FF50437357.key' -O /etc/apk/keys/cli@doppler-8004D9FF50437357.rsa.pub && \
    echo 'https://packages.doppler.com/public/cli/alpine/any-version/main' >> /etc/apk/repositories && \
    apk add --no-cache doppler

FROM base AS pruner
WORKDIR /app
RUN pnpm add -g turbo@2.10.6
COPY . .
RUN turbo prune @orbit/web --docker

FROM base AS installer
WORKDIR /app
RUN apk add --no-cache libc6-compat
ENV NODE_OPTIONS=--max-old-space-size=4096
COPY --from=doppler /usr/bin/doppler /usr/bin/doppler
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json ./
RUN --mount=type=secret,id=DOPPLER_TOKEN,required=false \
    set -eu; \
    if [ -s /run/secrets/DOPPLER_TOKEN ]; then \
      export DOPPLER_INTERACTIVE=false; \
      export DOPPLER_TOKEN="$(cat /run/secrets/DOPPLER_TOKEN)"; \
      doppler run -- pnpm --filter @orbit/web run build; \
    else \
      echo "No Doppler token supplied, building with placeholder configuration."; \
      echo "This image is only fit for build verification, never for deployment."; \
      DATABASE_URL="postgres://placeholder:placeholder@127.0.0.1:5432/placeholder" \
      BETTER_AUTH_SECRET="placeholder-secret-0123456789abcdef" \
      pnpm --filter @orbit/web run build; \
    fi

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -S orbit && adduser -S orbit -G orbit
COPY --from=doppler /usr/bin/doppler /usr/bin/doppler
COPY --from=installer --chown=orbit:orbit /app/apps/web/.next/standalone ./
COPY --from=installer --chown=orbit:orbit /app/apps/web/.next/static ./apps/web/.next/static
USER orbit
EXPOSE 3000
CMD ["/usr/bin/doppler", "run", "--", "node", "apps/web/server.js"]
