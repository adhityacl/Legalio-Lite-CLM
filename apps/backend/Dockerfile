FROM node:22-bookworm-slim AS build
WORKDIR /repo
# Dependency layer first: only re-runs when a package manifest or the lockfile changes.
COPY package.json package-lock.json ./
COPY scripts/setup-env.mjs scripts/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/platform-console/package.json packages/platform-console/
COPY packages/shared/package.json packages/shared/
COPY packages/types/package.json packages/types/
COPY packages/ui-components/package.json packages/ui-components/
COPY packages/ts-config/package.json packages/ts-config/
RUN npm ci --workspace @legalio/backend --include-workspace-root
COPY . .
RUN npm run build:backend && npm prune --omit=dev --workspace @legalio/backend --include-workspace-root

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 APP_DATA_DIR=/data
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/backend/dist ./apps/backend/dist
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/backend/dist/server.cjs"]
