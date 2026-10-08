# Floor Stock image. Build from the repo root:  docker build -f apps/floor-stock/Dockerfile -t plantops-floor-stock .
# All configuration comes from environment variables at runtime (see .env.example); no secrets in the image.
# No files are stored: everything is in the database. Migrations run separately with the owner login:
#   pnpm --filter @plantops/floor-stock db:migrate   (hosted copies: ./scripts/railway-migrate.sh <copy>)
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @plantops/floor-stock build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3002 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/floor-stock/.next/standalone ./
COPY --from=build /repo/apps/floor-stock/.next/static ./apps/floor-stock/.next/static
USER node
EXPOSE 3002
CMD ["node", "apps/floor-stock/server.js"]
