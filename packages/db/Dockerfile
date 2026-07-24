# syntax=docker/dockerfile:1.7
ARG DEPS_IMAGE=orbit-deps:build

FROM ${DEPS_IMAGE} AS runner
RUN addgroup -S orbit && adduser -S orbit -G orbit
COPY tsconfig.base.json ./
COPY packages packages
USER orbit
WORKDIR /app/packages/db
CMD ["/usr/bin/doppler", "run", "--", "bun", "run", "push"]
