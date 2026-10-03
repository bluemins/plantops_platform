# Document Store image. Build from the repo root:  docker build -f apps/document-store/Dockerfile -t plantops-document-store .
# All configuration comes from environment variables at runtime (see .env.example); no secrets in the image.
# Files: mount a volume at DOC_STORAGE_DIR, or (recommended) set STORAGE_BUCKET for S3-compatible storage.
# Migrations run separately with the owner login: pnpm --filter @plantops/document-store db:migrate
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @plantops/document-store build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3003 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/document-store/.next/standalone ./
COPY --from=build /repo/apps/document-store/.next/static ./apps/document-store/.next/static
USER node
EXPOSE 3003
CMD ["node", "apps/document-store/server.js"]
