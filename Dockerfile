# syntax=docker/dockerfile:1.7
# Build stage — build @iusehalo/halo-api once, then both Vite apps + the MCP server off it.
FROM node:26-alpine AS build
WORKDIR /app

# Workspace skeleton first so `npm ci` resolves cross-workspace deps without
# pulling in source. Each app's package.json gets copied into its workspace
# directory, then `npm ci` reads the root lockfile to install everything.
COPY package.json package-lock.json* ./
COPY packages/halo-api/package.json packages/halo-api/package.json
COPY apps/outlook/package.json apps/outlook/package.json
COPY apps/teams/package.json apps/teams/package.json
COPY apps/mcp/package.json apps/mcp/package.json

RUN npm ci || npm install

# Now the rest of the source — keeps the dep install layer cacheable.
COPY . .

# Builds in order: halo-api → outlook → teams → mcp.
RUN npm run build:outlook && npm run build:teams && npm run build:mcp

# MCP production deps (omit dev) for the runtime stage. We do a second
# workspace-aware install with --omit=dev so the runtime image carries only
# what's needed to run apps/mcp.
FROM node:26-alpine AS mcp-runtime-deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/halo-api/package.json packages/halo-api/package.json
COPY apps/outlook/package.json apps/outlook/package.json
COPY apps/teams/package.json apps/teams/package.json
COPY apps/mcp/package.json apps/mcp/package.json
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts

# Runtime stage — one container, two processes:
#   - nginx serves static SPAs and reverse-proxies /mcp/* + /auth/callback to node
#   - node runs the MCP HTTP server on localhost:3001
#
# nginx is PID 1; node runs as a backgrounded child. If node dies, the static
# surfaces keep serving (degraded — AI agents will fail until restart).
FROM node:26-alpine AS runtime
RUN apk add --no-cache nginx tini && mkdir -p /run/nginx
WORKDIR /app

# Static SPAs into the nginx docroot.
COPY --from=build /app/apps/outlook/dist /usr/share/nginx/html/outlook
COPY --from=build /app/apps/teams/dist /usr/share/nginx/html/teams
COPY landing/index.html /usr/share/nginx/html/index.html
COPY landing/favicon.png /usr/share/nginx/html/favicon.png
COPY landing/favicon.png /usr/share/nginx/html/favicon.ico
COPY landing/mcp-setup /usr/share/nginx/html/mcp-setup
COPY nginx.conf /etc/nginx/http.d/default.conf

# MCP runtime: halo-api dist + mcp dist + the hoisted production node_modules.
COPY --from=build /app/packages/halo-api/dist ./packages/halo-api/dist
COPY --from=build /app/packages/halo-api/package.json ./packages/halo-api/package.json
COPY --from=build /app/apps/mcp/dist ./apps/mcp/dist
COPY --from=build /app/apps/mcp/package.json ./apps/mcp/package.json
COPY --from=build /app/package.json ./package.json
COPY --from=mcp-runtime-deps /app/node_modules ./node_modules

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV MCP_PORT=3001 \
    MCP_TRANSPORT=http \
    NODE_ENV=production

EXPOSE 80
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/usr/local/bin/docker-entrypoint.sh"]
