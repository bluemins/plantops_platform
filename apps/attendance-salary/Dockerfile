# Attendance image. Build from the repo root:  docker build -f apps/attendance-salary/Dockerfile -t plantops-attendance-salary .
# All configuration comes from environment variables at runtime (see .env.example); no secrets in the image.
# Attendance stores no files (a scan keeps only the distance and accuracy): no volume and no storage settings.
# Migrations run separately with the owner login: pnpm --filter @plantops/attendance-salary db:migrate
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @plantops/attendance-salary build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3006 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/attendance-salary/.next/standalone ./
COPY --from=build /repo/apps/attendance-salary/.next/static ./apps/attendance-salary/.next/static
USER node
EXPOSE 3006
CMD ["node", "apps/attendance-salary/server.js"]
