// ==============================================================================
// Hybrid Storage Cache — orchestrator
//   size <= 2GB  -> Telegram (Local Bot API), stored file_id on the Movie row
//   size  > 2GB  -> Google Drive, account picked by free quota (total - used)
//                   from the DriveAccount table; LRU auto-cleanup when all
//                   accounts are full (oldest lastDownloadedAt > 2GB file first)
// ==============================================================================
import fs from 'fs';
import prisma from '../prisma/client.js';
import { config, formatBytes } from './config.js';
import * as telegramStore from './telegramStore.js';
import * as driveStore from './driveStore.js';

// Movie ids that currently have an upload in flight (prevents duplicate jobs)
const processing = new Set();

/** Size-based routing rule (requirement 1) */
export function routeForSize(sizeBytes) {
  return sizeBytes <= config.telegram.maxSizeBytes ? 'telegram' : 'gdrive';
}

function assertRouteConfigured(route) {
  if (route === 'telegram' && !config.telegram.configured) {
    throw Object.assign(
      new Error('Telegram storage is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID). Cannot cache files <= 2GB.'),
      { statusCode: 503 }
    );
  }
  if (route === 'gdrive' && !config.gdrive.configured) {
    throw Object.assign(
      new Error('Google Drive storage is not configured (GDRIVE_CREDENTIALS_JSON / GDRIVE_CREDENTIALS_DIR). Cannot cache files > 2GB.'),
      { statusCode: 503 }
    );
  }
}

/**
 * Requirement 4 (selection): find a DriveAccount with enough free space
 * (totalSpace - usedSpace). Uses BEST-FIT (smallest account that still fits)
 * so the emptiest accounts stay available for the biggest files.
 */
async function selectDriveAccount(neededBytes) {
  const accounts = await prisma.driveAccount.findMany();
  const candidates = accounts
    .map((a) => ({ ...a, freeSpace: a.totalSpace - a.usedSpace }))
    .filter((a) => a.freeSpace >= neededBytes + config.gdrive.freeSpaceBufferBytes)
    .sort((a, b) => a.freeSpace - b.freeSpace);
  return candidates[0] || null;
}

/**
 * Requirement 4 (LRU auto-cleanup): delete the > 2GB Drive-cached movie with
 * the OLDEST lastDownloadedAt, free its space in the DriveAccount table, and
 * unlink it from the movie record. Returns null when there is nothing to evict.
 */
async function evictOldestDriveMovie() {
  const victim = await prisma.movie.findFirst({
    where: { driveFileId: { not: null }, size: { gt: config.telegram.maxSizeBytes } },
    orderBy: { lastDownloadedAt: 'asc' },
    include: { driveAccount: true },
  });

  if (!victim) return null;

  const lastSeen = victim.lastDownloadedAt instanceof Date
    ? victim.lastDownloadedAt.toISOString()
    : String(victim.lastDownloadedAt);
  console.log(`[HYBRID_LRU] All accounts full — evicting "${victim.title}" (${formatBytes(victim.size)}, last downloaded ${lastSeen})`);

  if (victim.driveAccount) {
    await driveStore.deleteFile(victim.driveAccount, victim.driveFileId);
    await prisma.driveAccount.update({
      where: { id: victim.driveAccount.id },
      data: { usedSpace: Math.max(0, victim.driveAccount.usedSpace - victim.size) },
    });
  } else {
    // Orphaned record (account row was removed) — just unlink it so it stops blocking LRU
    console.warn(`[HYBRID_LRU] Victim "${victim.title}" has no DriveAccount row — unlinking record only`);
  }

  await prisma.movie.update({
    where: { id: victim.id },
    data: { driveFileId: null, driveAccountId: null },
  });

  return { movieId: victim.id, title: victim.title, freedBytes: victim.size || 0 };
}

/**
 * Guarantee a DriveAccount with room for `neededBytes`:
 * pick one, and if all are full run the LRU eviction loop until space frees up.
 */
async function ensureDriveSpace(neededBytes) {
  for (let attempt = 0; attempt < config.lru.maxEvictionsPerRequest; attempt += 1) {
    const account = await selectDriveAccount(neededBytes);
    if (account) {
      console.log(`[HYBRID_GDRIVE] Selected account ${account.email} (free: ${formatBytes(account.totalSpace - account.usedSpace)})`);
      return account;
    }

    const evicted = await evictOldestDriveMovie();
    if (!evicted) {
      throw Object.assign(
        new Error(`All Google Drive accounts are full (need ${formatBytes(neededBytes)}) and there is nothing left to evict.`),
        { statusCode: 507 }
      );
    }

    // Google's quota counters can lag a few seconds behind deletions
    await new Promise((resolve) => setTimeout(resolve, config.lru.quotaSettleMs));
  }

  throw Object.assign(new Error('LRU eviction limit reached before enough space was freed.'), { statusCode: 507 });
}

/**
 * The actual upload work for one cache job (runs in the background).
 * On failure the movie simply stays uncached (both file id columns null) and
 * can be re-initiated at any time.
 */
async function processCacheJob(movieId, { filePath, uploadName, mimeType }) {
  try {
    const movie = await prisma.movie.findUnique({ where: { id: movieId } });
    if (!movie) return;

    if (routeForSize(movie.size) === 'telegram') {
      console.log(`[HYBRID_CACHE] Routing "${movie.title}" (${formatBytes(movie.size)}) -> TELEGRAM`);
      const { fileId } = await telegramStore.uploadFile(filePath, {
        title: movie.title,
        fileName: movie.fileName || uploadName,
      });
      await prisma.movie.update({ where: { id: movieId }, data: { telegramFileId: fileId } });
      console.log(`[HYBRID_CACHE] DONE (telegram) "${movie.title}"`);
    } else {
      console.log(`[HYBRID_CACHE] Routing "${movie.title}" (${formatBytes(movie.size)}) -> GOOGLE DRIVE`);
      const account = await ensureDriveSpace(movie.size);
      const { fileId } = await driveStore.uploadFile(account, filePath, uploadName, mimeType);

      await prisma.movie.update({
        where: { id: movieId },
        data: { driveFileId: fileId, driveAccountId: account.id },
      });
      await prisma.driveAccount.update({
        where: { id: account.id },
        data: { usedSpace: { increment: movie.size } },
      });
      console.log(`[HYBRID_CACHE] DONE (gdrive/${account.email}) "${movie.title}"`);
    }
  } catch (err) {
    console.error(`[HYBRID_CACHE] Job failed for movie ${movieId}:`, err.message);
    throw err;
  }
}

/**
 * Entry point used by POST /initiate.
 * Validates input, dedupes (already cached / already in-flight), registers the
 * Movie row and kicks off the background upload. The caller responds
 * immediately; `promise` (when present) resolves when the upload finishes.
 */
export async function startCacheJob(input = {}) {
  const { movieId, title, size, fileName, filePath, mimeType } = input;
  const parsedSize = Number(size);

  if (!title) throw Object.assign(new Error('title is required'), { statusCode: 400 });
  if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
    throw Object.assign(new Error('size (bytes of the largest file in the torrent) is required and must be > 0'), { statusCode: 400 });
  }
  if (!filePath) {
    throw Object.assign(new Error('filePath (server-local path of the downloaded file) is required'), { statusCode: 400 });
  }
  if (!fs.existsSync(filePath)) {
    throw Object.assign(new Error(`filePath does not exist on the server: ${filePath}`), { statusCode: 400 });
  }

  const route = routeForSize(parsedSize);
  assertRouteConfigured(route);

  // Reuse an existing record for the same movie when possible
  let movie = null;
  if (movieId) {
    movie = await prisma.movie.findUnique({ where: { id: movieId } }).catch(() => null);
  }
  if (!movie) {
    movie = await prisma.movie.findFirst({ where: { title } });
  }

  if (movie && (movie.telegramFileId || movie.driveFileId)) {
    return {
      movie,
      state: 'already-cached',
      route: movie.telegramFileId ? 'telegram' : 'gdrive',
      promise: null,
    };
  }

  if (!movie) {
    movie = await prisma.movie.create({
      data: {
        title,
        size: parsedSize,
        fileName: fileName || null,
        mimeType: mimeType || null,
        cachedAt: new Date(),
        lastDownloadedAt: new Date(),
      },
    });
  }

  if (processing.has(movie.id)) {
    return { movie, state: 'already-processing', route, promise: null };
  }

  processing.add(movie.id);
  const promise = processCacheJob(movie.id, {
    filePath,
    uploadName: fileName || title,
    mimeType,
  }).finally(() => processing.delete(movie.id));

  return { movie, state: 'started', route, promise };
}

/**
 * Queue a movie for caching from its magnet link (NON-BLOCKING).
 * Creates (or updates) the Movie row and stores the magnet so the
 * torrent-to-stream pipeline can pick the job up — once the file is on disk it
 * calls POST /initiate with the filePath and the real upload pipeline runs.
 * Returns the DB record immediately (this is what GET /download calls for
 * uncached movies).
 */
export async function cacheMovie({ movieId, title, magnetLink, size, fileName } = {}) {
  if (!movieId && !title && !magnetLink) {
    throw Object.assign(
      new Error('cacheMovie requires at least one of: movieId, title, magnetLink'),
      { statusCode: 400 }
    );
  }

  // Reuse an existing record when possible (matched by id, then title)
  let movie = null;
  if (movieId) {
    movie = await prisma.movie.findUnique({ where: { id: movieId } }).catch(() => null);
  }
  if (!movie && title) {
    movie = await prisma.movie.findFirst({ where: { title } });
  }

  if (!movie) {
    movie = await prisma.movie.create({
      data: {
        title: title || 'Unknown Title',
        size: Number(size) || 0,
        fileName: fileName || null,
        magnetLink: magnetLink || null,
        cachedAt: new Date(),
        lastDownloadedAt: new Date(),
      },
    });
    console.log(`[HYBRID_CACHE] Queued "${movie.title}" for caching (movieId ${movie.id})`);
    return movie;
  }

  if (magnetLink && movie.magnetLink !== magnetLink) {
    movie = await prisma.movie.update({ where: { id: movie.id }, data: { magnetLink } });
  }
  return movie;
}

/** Look up a cache entry WITHOUT touching LRU (used by /status) */
export async function peekCacheEntry(idOrTitle) {
  if (!idOrTitle) return null;
  let movie = await prisma.movie.findUnique({ where: { id: idOrTitle } });
  if (!movie) movie = await prisma.movie.findFirst({ where: { title: idOrTitle } });
  if (!movie) return null;

  if (movie.telegramFileId) return { movie, storageType: 'telegram', cached: true };
  if (movie.driveFileId) return { movie, storageType: 'gdrive', cached: true };
  return { movie, storageType: null, cached: false };
}

/**
 * Requirement 5: serve the direct link and touch lastDownloadedAt on EVERY
 * request — for BOTH storage types (timestamps also keep recently downloaded
 * movies safe from any future cleanup policies).
 */
export async function getDownloadLink(idOrTitle) {
  const entry = await peekCacheEntry(idOrTitle);
  if (!entry) return null;

  const { movie } = entry;
  await prisma.movie.update({
    where: { id: movie.id },
    data: { lastDownloadedAt: new Date() },
  });

  if (entry.storageType === 'telegram') {
    const directLink = await telegramStore.getDirectLink(movie.telegramFileId);
    return { ...entry, directLink };
  }

  if (entry.storageType === 'gdrive') {
    const account = movie.driveAccountId
      ? await prisma.driveAccount.findUnique({ where: { id: movie.driveAccountId } })
      : null;
    return { ...entry, account, directLink: driveStore.buildDirectLink(movie.driveFileId) };
  }

  return { ...entry, directLink: null };
}

/**
 * Create DriveAccount rows from the configured credentials (idempotent —
 * matched by email). Call once after adding accounts to the environment.
 */
export async function syncDriveAccounts() {
  if (!config.gdrive.configured) {
    throw Object.assign(new Error('No Google Drive credentials configured.'), { statusCode: 503 });
  }
  const created = [];
  for (const [index, entry] of config.gdrive.entries.entries()) {
    const email = entry.email || `gdrive-sa-${index + 1}`;
    const existing = await prisma.driveAccount.findUnique({ where: { email } });
    if (!existing) {
      await prisma.driveAccount.create({
        data: {
          credentials: entry.raw,
          email,
          totalSpace: config.gdrive.defaultAccountBytes,
          usedSpace: 0,
        },
      });
      created.push(email);
    }
  }
  return { created, totalConfigured: config.gdrive.entries.length };
}

/** Overview for /stats: per-account free space + cache counters */
export async function getCacheStats() {
  const [accounts, telegramCount, driveCount, uncachedCount] = await Promise.all([
    prisma.driveAccount.findMany().catch(() => []),
    prisma.movie.count({ where: { telegramFileId: { not: null } } }),
    prisma.movie.count({ where: { driveFileId: { not: null } } }),
    prisma.movie.count({ where: { telegramFileId: null, driveFileId: null } }),
  ]);

  return {
    telegram: {
      configured: config.telegram.configured,
      localApiUrl: config.telegram.localApiUrl,
      maxSizeBytes: config.telegram.maxSizeBytes,
      cachedMovies: telegramCount,
    },
    gdrive: {
      configured: config.gdrive.configured,
      accounts: accounts.map((a) => ({
        id: a.id,
        email: a.email,
        totalSpace: a.totalSpace,
        usedSpace: a.usedSpace,
        freeSpace: Math.max(0, a.totalSpace - a.usedSpace),
      })),
      totalFreeSpace: accounts.reduce((sum, a) => sum + Math.max(0, a.totalSpace - a.usedSpace), 0),
      cachedMovies: driveCount,
    },
    uncachedMovies: uncachedCount,
    processingNow: [...processing],
  };
}