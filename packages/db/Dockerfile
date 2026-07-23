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
RUN turbo prune @orbit/db --docker

FROM base AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=doppler /usr/bin/doppler /usr/bin/doppler
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json ./
WORKDIR /app/packages/db
CMD ["/usr/bin/doppler", "run", "--", "pnpm", "run", "push"]
