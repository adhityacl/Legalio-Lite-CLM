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
RUN npm ci --workspace @legalio/frontend --include-workspace-root
COPY . .
RUN npm run build:frontend

FROM nginx:1.30-alpine
ENV API_UPSTREAM=http://backend:3000
COPY --from=build /repo/apps/frontend/dist /usr/share/nginx/html
COPY apps/frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY apps/frontend/nginx/security-headers.conf apps/frontend/nginx/proxy-headers.conf /etc/nginx/snippets/
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
