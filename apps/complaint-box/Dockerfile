# Complaint Box image. Build from the repo root:  docker build -f apps/complaint-box/Dockerfile -t plantops-complaint-box .
# All configuration comes from environment variables at runtime (see .env.example); no secrets in the image.
# Photos / videos: mount a volume and point COMPLAINT_STORAGE_DIR at it (Railway: volume at /data,
# COMPLAINT_STORAGE_DIR=/data/complaints, RAILWAY_RUN_UID=0), or set COMPLAINT_STORAGE_BUCKET for S3-compatible
# storage. Never Document Store's folder or bucket.
# Migrations run separately with the owner login: pnpm --filter @plantops/complaint-box db:migrate
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @plantops/complaint-box build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3004 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/complaint-box/.next/standalone ./
COPY --from=build /repo/apps/complaint-box/.next/static ./apps/complaint-box/.next/static
USER node
EXPOSE 3004
CMD ["node", "apps/complaint-box/server.js"]
