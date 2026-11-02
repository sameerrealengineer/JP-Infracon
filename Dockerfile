# JP Infracon API — self-hosted image (open source stack: Node 22 + your MySQL 8).
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build:server

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 MIGRATIONS_DIR=/app/drizzle STORAGE_DIR=/data/files
COPY --from=build /app/dist-server ./dist-server
COPY drizzle ./drizzle
RUN mkdir -p /data/files && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/index.mjs"]
