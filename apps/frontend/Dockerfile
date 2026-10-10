FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY . .
RUN npm ci --workspace @legalio/frontend --include-workspace-root
RUN npm run build:frontend

FROM nginx:stable-alpine
ENV API_UPSTREAM=http://backend:3000
COPY --from=build /repo/apps/frontend/dist /usr/share/nginx/html
COPY apps/frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
