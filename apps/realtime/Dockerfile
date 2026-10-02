FROM oven/bun:1.3.14-alpine AS build

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --filter '@orbit/realtime' build

FROM oven/bun:1.3.14-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/realtime/package.json ./apps/realtime/package.json
COPY --from=build /app/apps/realtime/dist ./apps/realtime/dist
CMD ["bun", "apps/realtime/dist/outbox-worker.js"]
