# ===========================================
# Zenemozite Production Dockerfile
# Multi-stage build for optimized image size
# Using Debian-based images for Prisma compatibility
# ===========================================

# Stage 1: Build Frontend
FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /app

# Copy frontend package files
COPY package*.json ./
COPY vite.config.js ./
COPY postcss.config.js ./
COPY tailwind.config.js ./
COPY index.html ./
COPY public/ ./public/

# Install ALL dependencies (including devDependencies needed for build)
RUN npm ci --ignore-scripts

# Copy frontend source
COPY src/ ./src/

# Set API base URL to relative path so the built app works from any VPS IP/domain.
# When served on port 5000 alongside the backend, /api resolves to same-origin.
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

# Build frontend for production
RUN npm run build

# Stage 2: Build Backend Dependencies
FROM node:22-bookworm-slim AS backend-builder

WORKDIR /app/backend

# Install OpenSSL for Prisma (required for prisma generate)
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy backend package files
COPY backend/package*.json ./

# Install ALL backend dependencies (including prisma needed for generate)
RUN npm ci --ignore-scripts

# node-datachannel (pulled in by webtorrent -> webrtc-polyfill) ships its
# native WebRTC addon as a PREBUILT N-API binary that its `install` script
# downloads via prebuild-install. `npm ci --ignore-scripts` skips that script,
# so build/Release/node_datachannel.node would be missing and the container
# would crash at startup ("Cannot find module ... node_datachannel.node").
# Rebuild ONLY node-datachannel to fetch the prebuilt linux-x64 glibc binary:
# N-API 8 is ABI-stable, so it works with any Node >= 18.20 (incl. v22.x) and
# needs no compiler toolchain. Fail the build loudly if it cannot be fetched.
RUN npm rebuild node-datachannel \
    && test -f node_modules/node-datachannel/build/Release/node_datachannel.node \
    && node -e "require('node-datachannel'); console.log('node-datachannel native binary OK')"

# Copy Prisma schema
COPY backend/prisma ./prisma/

# Generate Prisma Client for Debian/glibc
RUN npx prisma generate

# Stage 3: Production Runtime
FROM node:22-bookworm-slim

# Install runtime dependencies: OpenSSL and dumb-init
RUN apt-get update && \
    apt-get install -y openssl dumb-init && \
    rm -rf /var/lib/apt/lists/*

# Create app user for security (don't run as root)
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -s /bin/bash -m nodejs

WORKDIR /app

# Copy backend dependencies from builder
COPY --from=backend-builder --chown=nodejs:nodejs /app/backend/node_modules ./backend/node_modules

# Copy backend source code (EVERYTHING the runtime imports)
#   backend/*.js  -> ALL backend root JS modules:
#                      server.js   -> Express entrypoint
#                      listCache.js -> TMDB list caching (imported by server.js)
#                    Using a glob instead of copying server.js alone ensures any
#                    new backend root module is included automatically.
#   storage/      -> hybrid cache module (Telegram / Google Drive / LRU), imported by server.js
#   prisma/       -> schema.prisma + client.js (client.js is imported by storage/hybridCache.js)
#   package*.json -> package metadata
# NOTE: .dockerignore keeps secrets (backend/.env) and dev databases (*.db) out of the
#       image; runtime DATABASE_URL always points at /app/data/zenemozite.db (volume).
COPY --chown=nodejs:nodejs backend/*.js ./backend/
COPY --chown=nodejs:nodejs backend/storage ./backend/storage/
COPY --chown=nodejs:nodejs backend/prisma/schema.prisma backend/prisma/client.js ./backend/prisma/
COPY --chown=nodejs:nodejs backend/package*.json ./backend/

# Copy entrypoint script (runs prisma db push before starting node)
COPY --chown=nodejs:nodejs backend/entrypoint.sh ./backend/entrypoint.sh
RUN chmod +x ./backend/entrypoint.sh

# Copy frontend build output
COPY --from=frontend-builder --chown=nodejs:nodejs /app/dist ./frontend/dist

# Verify the node-datachannel native addon was retained through the multi-stage
# copy (node_modules is copied wholesale, so the binary travels with it) and
# actually loads in the runtime image (Debian glibc, Node 22):
RUN node -e "require('/app/backend/node_modules/node-datachannel'); console.log('node-datachannel loads in runtime image')"

# Create directory for SQLite database with proper permissions
RUN mkdir -p /app/data && chown -R nodejs:nodejs /app/data

# Switch to non-root user
USER nodejs

# Expose backend port
EXPOSE 5000

# Set production environment
ENV NODE_ENV=production
ENV DATABASE_URL="file:/app/data/zenemozite.db"
ENV PORT=5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/api/status', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start: sync Prisma schema to SQLite, then start Express server
CMD ["./backend/entrypoint.sh"]
