# Build context is the REPO ROOT (docker-compose: context ".", dockerfile "frontend/Dockerfile"),
# because the web app consumes the shared TypeScript in packages/core as source.
# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci
COPY packages/core ./packages/core
COPY frontend ./frontend
RUN cd frontend && npm run build

# ---- runtime stage ----
FROM nginx:alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
