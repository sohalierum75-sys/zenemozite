# ===========================================
# MovieStream Production Dockerfile
# Multi-stage build for optimized image size
# ===========================================

# Stage 1: Build Frontend
FROM node:22-alpine AS frontend-builder

WORKDIR /app

# Copy frontend package files
COPY package*.json ./
COPY vite.config.js ./
COPY postcss.config.js ./
COPY tailwind.config.js ./
COPY index.html ./

# Install frontend dependencies
RUN npm ci --omit=dev --ignore-scripts

# Copy frontend source
COPY src/ ./src/

# Build frontend for production
RUN npm run build

# Stage 2: Build Backend Dependencies
FROM node:22-alpine AS backend-builder

WORKDIR /app/backend

# Copy backend package files
COPY backend/package*.json ./

# Install backend dependencies
RUN npm ci --omit=dev --ignore-scripts

# Copy Prisma schema
COPY backend/prisma ./prisma/

# Generate Prisma Client
RUN npx prisma generate

# Stage 3: Production Runtime
FROM node:22-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app user for security (don't run as root)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

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
ENV DATABASE_URL="file:/app/data/moviestream.db"
ENV PORT=5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/api/status', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start backend server
CMD ["node", "backend/server.js"]
