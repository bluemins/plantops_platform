# Lab Records image. Build from the repo root:  docker build -f apps/lab-records/Dockerfile -t plantops-lab-records .
# All configuration comes from environment variables at runtime (see .env.example); no secrets in the image.
# Migrations run separately with the owner login: pnpm --filter @plantops/lab-records db:migrate
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @plantops/lab-records build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/lab-records/.next/standalone ./
COPY --from=build /repo/apps/lab-records/.next/static ./apps/lab-records/.next/static
USER node
EXPOSE 3001
CMD ["node", "apps/lab-records/server.js"]
