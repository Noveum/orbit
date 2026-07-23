# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PNPM_HOME/bin:$PATH"
ENV CI=1
ENV TURBO_TELEMETRY_DISABLED=1
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
RUN turbo prune @orbit/realtime --docker

FROM base AS installer
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json ./
RUN pnpm --filter @orbit/realtime run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV REALTIME_PORT=3100
RUN addgroup -S orbit && adduser -S orbit -G orbit
COPY --from=doppler /usr/bin/doppler /usr/bin/doppler
COPY --from=installer --chown=orbit:orbit /app/apps/realtime/dist ./dist
USER orbit
EXPOSE 3100
CMD ["/usr/bin/doppler", "run", "--", "node", "dist/index.js"]
