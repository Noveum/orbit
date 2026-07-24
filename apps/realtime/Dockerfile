# syntax=docker/dockerfile:1.7
ARG DEPS_IMAGE=orbit-deps:build

FROM oven/bun:1.3.14-alpine AS base
ENV CI=1
WORKDIR /app

FROM ${DEPS_IMAGE} AS deps

FROM deps AS installer
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/realtime apps/realtime
RUN bun run --filter '@orbit/realtime' build

FROM base AS runner
ENV NODE_ENV=production
ENV REALTIME_PORT=3100
RUN addgroup -S orbit && adduser -S orbit -G orbit
COPY --from=deps /usr/bin/doppler /usr/bin/doppler
COPY --from=installer --chown=orbit:orbit /app/apps/realtime/dist ./dist
USER orbit
EXPOSE 3100
CMD ["/usr/bin/doppler", "run", "--", "bun", "dist/index.js"]
