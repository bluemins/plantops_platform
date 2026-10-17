# Job applications image. Build from the repo root:  docker build -f apps/job-applications/Dockerfile -t plantops-job-applications .
# All configuration comes from environment variables at runtime (see .env.example); no secrets in the image.
# Resumes: mount a volume and point JOBS_STORAGE_DIR at it (Railway: volume at /data, JOBS_STORAGE_DIR=/data/jobs,
# RAILWAY_RUN_UID=0), or set JOBS_STORAGE_BUCKET for S3-compatible storage. Never another module's folder or bucket.
# The public page needs JOBS_DEFAULT_PLANT (the plant at the bare address); Turnstile keys are optional.
# Migrations run separately with the owner login: pnpm --filter @plantops/job-applications db:migrate
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @plantops/job-applications build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3007 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/job-applications/.next/standalone ./
COPY --from=build /repo/apps/job-applications/.next/static ./apps/job-applications/.next/static
USER node
EXPOSE 3007
CMD ["node", "apps/job-applications/server.js"]
