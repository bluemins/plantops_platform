# Platform app image. Build from the repo root:  docker build -f apps/platform/Dockerfile -t plantops-platform .
# All configuration comes from environment variables at runtime (see .env.example); no secrets in the image.
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @plantops/platform build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/platform/.next/standalone ./
COPY --from=build /repo/apps/platform/.next/static ./apps/platform/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/platform/server.js"]
