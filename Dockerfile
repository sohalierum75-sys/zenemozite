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
COPY --from=backend-builder --chown=nodejs:nodejs /app/backend/prisma ./backend/prisma

# Copy backend source code
COPY --chown=nodejs:nodejs backend/server.js ./backend/
COPY --chown=nodejs:nodejs backend/package*.json ./backend/

# Copy frontend build output
COPY --from=frontend-builder --chown=nodejs:nodejs /app/dist ./frontend/dist

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

# Start backend server
CMD ["node", "backend/server.js"]
