FROM node:22-bookworm-slim
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --chown=node:node . .
USER node
EXPOSE 3000
CMD ["node", "apps/web/start.mjs"]
