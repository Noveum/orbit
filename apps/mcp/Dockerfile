# syntax=docker/dockerfile:1.7
ARG DEPS_IMAGE=orbit-deps:build

FROM oven/bun:1.3.14-alpine AS base
ENV CI=1
WORKDIR /app

FROM ${DEPS_IMAGE} AS deps

FROM deps AS installer
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/mcp apps/mcp
RUN bun run --filter '@orbit/mcp' build

FROM base AS runner
ENV NODE_ENV=production
ENV MCP_PORT=3200
RUN addgroup -S orbit && adduser -S orbit -G orbit
COPY --from=deps /usr/bin/doppler /usr/bin/doppler
COPY --from=installer --chown=orbit:orbit /app/apps/mcp/dist ./dist
USER orbit
EXPOSE 3200
CMD ["/usr/bin/doppler", "run", "--", "bun", "dist/index.js"]
