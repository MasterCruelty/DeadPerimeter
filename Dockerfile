# Multi-stage Dockerfile for Dead Perimeter.
#
# Stages:
#   deps   — install npm dependencies (cacheable layer)
#   dev    — runs `npm run dev` for live development with Vite HMR
#   build  — produces the static bundle at /app/dist
#   prod   — nginx:alpine that serves /app/dist on port 80 (default target)
#
# Build the production image (default):
#   docker build -t dead-perimeter .
#   docker run --rm -p 8080:80 dead-perimeter
#
# Run the dev server in a container (mount source for hot reload):
#   docker build --target dev -t dead-perimeter:dev .
#   docker run --rm -it -p 5173:5173 -v "$PWD":/app -v /app/node_modules dead-perimeter:dev
#
# Or use the bundled docker-compose.yml:
#   docker compose up                 # production on http://localhost:8080
#   docker compose --profile dev up   # dev server   on http://localhost:5173

# ─────────────────────────── deps ───────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Install deps with a deterministic lockfile install. Cache this layer
# unless package.json / package-lock.json change.
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ─────────────────────────── dev ────────────────────────────
FROM node:20-alpine AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 5173
# `--host` so the dev server binds 0.0.0.0 and is reachable from the host
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

# ─────────────────────────── build ──────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ─────────────────────────── prod (default) ─────────────────
FROM nginx:1.27-alpine AS prod
LABEL org.opencontainers.image.title="Dead Perimeter"
LABEL org.opencontainers.image.description="2D zombie siege survival game (React + Canvas 2D)"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/MasterCruelty/DeadPerimeter"

# Replace the default site with our config (gzip + SPA-style fallback)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the static bundle
COPY --from=build /app/dist /usr/share/nginx/html

# Healthcheck: make sure nginx serves index.html
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
