# Order Capture image. Build from the repo root:  docker build -f apps/order-capture/Dockerfile -t plantops-order-capture .
# All configuration comes from environment variables at runtime (see .env.example); no secrets in the image.
# Order Capture stores no files: no volume and no storage settings.
# Migrations run separately with the owner login: pnpm --filter @plantops/order-capture db:migrate
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @plantops/order-capture build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3005 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/order-capture/.next/standalone ./
COPY --from=build /repo/apps/order-capture/.next/static ./apps/order-capture/.next/static
USER node
EXPOSE 3005
CMD ["node", "apps/order-capture/server.js"]
