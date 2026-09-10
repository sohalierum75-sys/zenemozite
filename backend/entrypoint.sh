#!/bin/sh
set -e

# =============================================================================
# Zenemozite Docker Entrypoint
# Guarantees the SQLite database has the latest Prisma schema before the
# Express server starts. Runs on EVERY container start (initial deploy,
# restarts, and schema-change deployments).
# ==============================================================================

echo "[ENTRYPOINT] Syncing Prisma schema to SQLite..."
cd /app/backend

# --skip-generate: the Prisma Client was already generated in the builder
#   stage with the SAME schema, so regeneration is unnecessary.
# --accept-data-loss: destructive schema changes (dropped columns/tables) are
#   applied automatically. This is a CACHE database — no user data to lose.
npx prisma db push --skip-generate --accept-data-loss

echo "[ENTRYPOINT] Prisma schema is up to date. Starting Express server..."

# --expose-gc: lets the chunker call global.gc() after each Telegram chunk
# upload so multipart scratch buffers are reclaimed immediately instead of
# lingering in RAM between chunks (OOM protection on 1-2GB VPSes).
# exec replaces the shell process with node — signals from dumb-init
# reach node directly for clean shutdowns
exec node --expose-gc server.js