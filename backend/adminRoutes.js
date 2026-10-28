import express from 'express';
import prisma from './prisma/client.js';
import { parseTelegramFiles, parseTelegramFileMetadata } from './storage/telegramParser.js';
import {
  verifyChannelAccess,
  retryImport,
  removeMovieVariant,
  registerWebhook,
  getWebhookInfo,
  manualImport,
} from './services/telegramImportService.js';

import axios from 'axios';
import { config } from './storage/config.js';
import { generateSignedDownloadToken, verifySignedDownloadToken } from './services/downloadService.js';
import { getUserbotClient } from './storage/userbot.js';

const router = express.Router();

/**
 * Safely parse JSON array or return empty array
 */
function parseJsonArray(str) {
  try {
    const val = typeof str === 'string' ? JSON.parse(str) : str;
    return Array.isArray(val) ? val : [];
  } catch {
    return [];
  }
}

/**
 * Helper to fetch all download links associated with a movie (by UUID or TMDB ID)
 */
export async function getDownloadLinksForMovie(identifier) {
  if (!identifier) return [];
  const idStr = String(identifier).trim();
  const idNum = parseInt(identifier, 10);

  try {
    // 1. Fetch from DownloadLink relational table
    const links = await prisma.downloadLink.findMany({
      where: {
        OR: [
          { movieId: idStr },
          { tmdbId: idStr },
          ...(Number.isInteger(idNum) ? [{ tmdbId: String(idNum) }] : [])
        ]
      },
      orderBy: { createdAt: 'asc' }
    });

    if (links && links.length > 0) {
      return links.map(l => ({
        id: l.id,
        movieId: l.movieId,
        tmdbId: l.tmdbId,
        provider: l.provider,
        quality: l.quality,
        url: l.url,
        size: l.size || null,
        createdAt: l.createdAt
      }));
    }

    // 2. Fallback to Movie with related downloadLinks
    const movie = await prisma.movie.findFirst({
      where: {
        OR: [
          { id: idStr },
          { title: idStr },
          ...(Number.isInteger(idNum) ? [{ tmdbId: idNum }] : [])
        ]
      },
      include: {
        downloadLinks: true
      }
    });

    if (movie?.downloadLinks && movie.downloadLinks.length > 0) {
      return movie.downloadLinks.map(l => ({
        id: l.id,
        movieId: l.movieId,
        tmdbId: l.tmdbId,
        provider: l.provider,
        quality: l.quality,
        url: l.url,
        size: l.size || null,
        createdAt: l.createdAt
      }));
    }

    if (movie?.download_links) {
      const parsed = parseJsonArray(movie.download_links);
      if (parsed.length > 0) return parsed;
    }

    // 3. Fallback to MediaCache.download_links JSON column
    const cached = await prisma.mediaCache.findUnique({
      where: { tmdbId: idStr }
    });

    if (cached?.download_links) {
      const parsed = parseJsonArray(cached.download_links);
      if (parsed.length > 0) return parsed;
    }

    return [];
  } catch (err) {
    console.warn('[DDL] Error loading download links:', err.message);
    return [];
  }
}

// ==============================================================================
// ADMIN ROUTES FOR MANAGING DIRECT DOWNLOAD LINKS (DDL)
// ==============================================================================

/**
 * GET /api/admin/movies
 * List movies with their direct download links
 */
router.get('/movies', async (req, res) => {
  try {
    const { search, limit = 50, page = 1 } = req.query;
    const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

    const where = search
      ? { title: { contains: String(search).trim() } }
      : {};

    const [movies, total] = await Promise.all([
      prisma.movie.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
        include: { downloadLinks: true }
      }),
      prisma.movie.count({ where })
    ]);

    const formatted = movies.map(m => {
      let links = m.downloadLinks || [];
      if (links.length === 0 && m.download_links) {
        links = parseJsonArray(m.download_links);
      }
      return {
        id: m.id,
        tmdbId: m.tmdbId,
        title: m.title,
        status: m.status,
        posterPath: m.posterPath,
        releaseDate: m.releaseDate,
        createdAt: m.createdAt,
        download_links: links,
        telegram_files: parseTelegramFiles(m.telegram_files)
      };
    });

    res.json({
      success: true,
      data: formatted,
      pagination: {
        total,
        page: parseInt(page, 10) || 1,
        limit: take,
        pages: Math.ceil(total / take)
      }
    });
  } catch (err) {
    console.error('[ADMIN] Error listing movies:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/admin/movies/:id
 * Get a specific movie with all direct download links
 */
router.get('/movies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const idNum = parseInt(id, 10);

    let movie = await prisma.movie.findFirst({
      where: {
        OR: [
          { id },
          ...(Number.isInteger(idNum) ? [{ tmdbId: idNum }] : [])
        ]
      },
      include: { downloadLinks: true }
    });

    const links = await getDownloadLinksForMovie(id);

    if (!movie) {
      // Check MediaCache
      const cached = await prisma.mediaCache.findUnique({
        where: { tmdbId: id }
      });
      if (cached) {
        return res.json({
          success: true,
          data: {
            id: cached.id,
            tmdbId: parseInt(cached.tmdbId, 10) || null,
            title: cached.title,
            year: cached.year,
            poster: cached.poster,
            download_links: links,
            telegram_files: parseTelegramFiles(cached.telegram_files)
          }
        });
      }
      return res.status(404).json({ success: false, message: 'Movie not found' });
    }

    res.json({
      success: true,
      data: {
        ...movie,
        download_links: links,
        telegram_files: parseTelegramFiles(movie.telegram_files)
      }
    });
  } catch (err) {
    console.error('[ADMIN] Error fetching movie:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/movies
 * Create or save a movie with direct download links and telegram files
 */
router.post('/movies', async (req, res) => {
  try {
    const {
      title,
      tmdbId,
      posterPath,
      backdropPath,
      releaseDate,
      download_links = [],
      telegram_files = []
    } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }

    const tmdbIdInt = tmdbId ? parseInt(tmdbId, 10) : null;
    const linksArray = Array.isArray(download_links) ? download_links : [];
    const tgFiles = parseTelegramFiles(telegram_files);
    const tgFilesJson = tgFiles.length > 0 ? JSON.stringify(tgFiles) : null;

    // Upsert movie record
    let movie = null;
    if (tmdbIdInt) {
      movie = await prisma.movie.upsert({
        where: { tmdbId: tmdbIdInt },
        update: {
          title,
          posterPath: posterPath || undefined,
          backdropPath: backdropPath || undefined,
          releaseDate: releaseDate || undefined,
          download_links: JSON.stringify(linksArray),
          ...(tgFilesJson ? { telegram_files: tgFilesJson } : {})
        },
        create: {
          title,
          tmdbId: tmdbIdInt,
          posterPath: posterPath || null,
          backdropPath: backdropPath || null,
          releaseDate: releaseDate || null,
          download_links: JSON.stringify(linksArray),
          telegram_files: tgFilesJson,
          status: 'ready'
        }
      });
    } else {
      movie = await prisma.movie.create({
        data: {
          title,
          posterPath: posterPath || null,
          backdropPath: backdropPath || null,
          releaseDate: releaseDate || null,
          download_links: JSON.stringify(linksArray),
          telegram_files: tgFilesJson,
          status: 'ready'
        }
      });
    }

    // Save individual links into DownloadLink relation table
    if (linksArray.length > 0) {
      for (const link of linksArray) {
        if (link.url) {
          await prisma.downloadLink.create({
            data: {
              movieId: movie.id,
              tmdbId: tmdbIdInt ? String(tmdbIdInt) : null,
              provider: link.provider || 'Direct',
              quality: link.quality || '1080p',
              url: link.url,
              size: link.size || null
            }
          });
        }
      }
    }

    // Also update MediaCache if it exists for this tmdbId
    if (tmdbIdInt) {
      await prisma.mediaCache.updateMany({
        where: { tmdbId: String(tmdbIdInt) },
        data: {
          download_links: JSON.stringify(linksArray),
          ...(tgFilesJson ? { telegram_files: tgFilesJson } : {})
        }
      }).catch(() => {});
    }

    const savedLinks = await getDownloadLinksForMovie(movie.id);

    res.status(201).json({
      success: true,
      message: 'Movie and download links saved successfully',
      data: {
        ...movie,
        download_links: savedLinks,
        telegram_files: tgFiles
      }
    });
  } catch (err) {
    console.error('[ADMIN] Error creating movie:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/admin/movies/:id
 * Update movie and replace/sync direct download links and telegram files
 */
router.put('/movies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      tmdbId,
      posterPath,
      backdropPath,
      releaseDate,
      download_links,
      telegram_files
    } = req.body;

    const idNum = parseInt(id, 10);
    const existingMovie = await prisma.movie.findFirst({
      where: {
        OR: [
          { id },
          ...(Number.isInteger(idNum) ? [{ tmdbId: idNum }] : [])
        ]
      }
    });

    let updatedMovie = null;
    const linksArray = Array.isArray(download_links) ? download_links : null;
    const hasTgFiles = telegram_files !== undefined;
    const tgFiles = hasTgFiles ? parseTelegramFiles(telegram_files) : null;

    if (existingMovie) {
      updatedMovie = await prisma.movie.update({
        where: { id: existingMovie.id },
        data: {
          title: title || existingMovie.title,
          posterPath: posterPath !== undefined ? posterPath : existingMovie.posterPath,
          backdropPath: backdropPath !== undefined ? backdropPath : existingMovie.backdropPath,
          releaseDate: releaseDate !== undefined ? releaseDate : existingMovie.releaseDate,
          download_links: linksArray !== null ? JSON.stringify(linksArray) : existingMovie.download_links,
          telegram_files: hasTgFiles ? JSON.stringify(tgFiles) : existingMovie.telegram_files
        }
      });

      // Synchronize DownloadLink table if download_links array was provided
      if (linksArray !== null) {
        // Remove existing links for this movie
        await prisma.downloadLink.deleteMany({
          where: {
            OR: [
              { movieId: existingMovie.id },
              ...(existingMovie.tmdbId ? [{ tmdbId: String(existingMovie.tmdbId) }] : []),
              ...(Number.isInteger(idNum) ? [{ tmdbId: String(idNum) }] : [])
            ]
          }
        });

        // Insert fresh links
        for (const link of linksArray) {
          if (link.url) {
            await prisma.downloadLink.create({
              data: {
                movieId: existingMovie.id,
                tmdbId: existingMovie.tmdbId ? String(existingMovie.tmdbId) : (Number.isInteger(idNum) ? String(idNum) : null),
                provider: link.provider || 'Direct',
                quality: link.quality || '1080p',
                url: link.url,
                size: link.size || null
              }
            });
          }
        }
      }
    } else {
      // Movie didn't exist in Movie table, check or create via TMDB ID
      const tmdbIdInt = Number.isInteger(idNum) ? idNum : (tmdbId ? parseInt(tmdbId, 10) : null);
      if (tmdbIdInt) {
        updatedMovie = await prisma.movie.create({
          data: {
            title: title || `Movie ${tmdbIdInt}`,
            tmdbId: tmdbIdInt,
            posterPath: posterPath || null,
            backdropPath: backdropPath || null,
            releaseDate: releaseDate || null,
            download_links: linksArray !== null ? JSON.stringify(linksArray) : '[]',
            status: 'ready'
          }
        });

        if (linksArray) {
          for (const link of linksArray) {
            if (link.url) {
              await prisma.downloadLink.create({
                data: {
                  movieId: updatedMovie.id,
                  tmdbId: String(tmdbIdInt),
                  provider: link.provider || 'Direct',
                  quality: link.quality || '1080p',
                  url: link.url,
                  size: link.size || null
                }
              });
            }
          }
        }
      } else {
        return res.status(404).json({ success: false, message: 'Movie not found' });
      }
    }

    // Also update MediaCache if tmdbId is present
    const tmdbIdRef = updatedMovie.tmdbId || (Number.isInteger(idNum) ? idNum : null);
    if (tmdbIdRef) {
      const cacheUpdates = {};
      if (linksArray !== null) cacheUpdates.download_links = JSON.stringify(linksArray);
      if (hasTgFiles) cacheUpdates.telegram_files = JSON.stringify(tgFiles);
      if (Object.keys(cacheUpdates).length > 0) {
        await prisma.mediaCache.updateMany({
          where: { tmdbId: String(tmdbIdRef) },
          data: cacheUpdates
        }).catch(() => {});
      }
    }

    const currentLinks = await getDownloadLinksForMovie(updatedMovie.id);

    res.json({
      success: true,
      message: 'Movie updated successfully',
      data: {
        ...updatedMovie,
        download_links: currentLinks,
        telegram_files: parseTelegramFiles(updatedMovie.telegram_files)
      }
    });
  } catch (err) {
    console.error('[ADMIN] Error updating movie:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/movies/:id/telegram-files
 * Save or append telegram files for a movie with automatic metadata parsing
 */
router.post('/movies/:id/telegram-files', async (req, res) => {
  try {
    const { id } = req.params;
    const { telegram_files = [], file_id, file_name, caption, fileSize, quality, size } = req.body;

    const idNum = parseInt(id, 10);
    const movie = await prisma.movie.findFirst({
      where: {
        OR: [
          { id },
          ...(Number.isInteger(idNum) ? [{ tmdbId: idNum }] : [])
        ]
      }
    });

    if (!movie) {
      return res.status(404).json({ success: false, message: 'Movie not found' });
    }

    let filesToAdd = Array.isArray(telegram_files) ? [...telegram_files] : [];
    if (file_id) {
      filesToAdd.push({ file_id, file_name, caption, fileSize, quality, size });
    }

    // Existing files
    const existingFiles = parseTelegramFiles(movie.telegram_files);
    const combined = [...existingFiles, ...filesToAdd];
    const normalized = parseTelegramFiles(combined);

    const updated = await prisma.movie.update({
      where: { id: movie.id },
      data: { telegram_files: JSON.stringify(normalized) }
    });

    if (movie.tmdbId) {
      await prisma.mediaCache.updateMany({
        where: { tmdbId: String(movie.tmdbId) },
        data: { telegram_files: JSON.stringify(normalized) }
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: 'Telegram files updated successfully',
      data: {
        movieId: updated.id,
        telegram_files: normalized
      }
    });
  } catch (err) {
    console.error('[ADMIN] Error saving telegram files:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/telegram/parse-metadata (and alias /api/telegram/parse-metadata)
 * Standalone utility endpoint to parse file_name or message caption using Regex
 */
router.post(['/telegram/parse-metadata', '/parse-telegram-metadata'], async (req, res) => {
  try {
    const { file_name, caption, text, fileSize, size, file_id } = req.body;
    const parsed = parseTelegramFileMetadata({
      file_name,
      caption: caption || text,
      fileSize,
      size,
      file_id: file_id || 'preview_id'
    });

    res.json({
      success: true,
      data: parsed
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/movies/:id/download-links
 * Add one or multiple direct download links to a movie
 */
router.post('/movies/:id/download-links', async (req, res) => {
  try {
    const { id } = req.params;
    const idNum = parseInt(id, 10);
    const body = req.body;
    const linksToAdd = Array.isArray(body) ? body : [body];

    // Find movie or resolve TMDB ID
    let movie = await prisma.movie.findFirst({
      where: {
        OR: [
          { id },
          ...(Number.isInteger(idNum) ? [{ tmdbId: idNum }] : [])
        ]
      }
    });

    const tmdbIdStr = movie?.tmdbId ? String(movie.tmdbId) : (Number.isInteger(idNum) ? String(idNum) : null);

    const created = [];
    for (const link of linksToAdd) {
      if (!link.url) continue;
      const newLink = await prisma.downloadLink.create({
        data: {
          movieId: movie?.id || null,
          tmdbId: tmdbIdStr,
          provider: link.provider || 'Direct',
          quality: link.quality || '1080p',
          url: link.url,
          size: link.size || null
        }
      });
      created.push(newLink);
    }

    // Refresh and update JSON column for quick reads
    const allLinks = await getDownloadLinksForMovie(movie?.id || id);
    if (movie) {
      await prisma.movie.update({
        where: { id: movie.id },
        data: { download_links: JSON.stringify(allLinks) }
      }).catch(() => {});
    }
    if (tmdbIdStr) {
      await prisma.mediaCache.updateMany({
        where: { tmdbId: tmdbIdStr },
        data: { download_links: JSON.stringify(allLinks) }
      }).catch(() => {});
    }

    res.status(201).json({
      success: true,
      message: `Added ${created.length} download link(s)`,
      data: created,
      download_links: allLinks
    });
  } catch (err) {
    console.error('[ADMIN] Error adding download links:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/admin/download-links/:linkId
 * Edit a specific download link
 */
router.put('/download-links/:linkId', async (req, res) => {
  try {
    const { linkId } = req.params;
    const { provider, quality, url, size } = req.body;

    const existing = await prisma.downloadLink.findUnique({
      where: { id: linkId }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Download link not found' });
    }

    const updated = await prisma.downloadLink.update({
      where: { id: linkId },
      data: {
        provider: provider !== undefined ? provider : existing.provider,
        quality: quality !== undefined ? quality : existing.quality,
        url: url !== undefined ? url : existing.url,
        size: size !== undefined ? size : existing.size
      }
    });

    // Sync JSON columns
    const allLinks = await getDownloadLinksForMovie(existing.movieId || existing.tmdbId);
    if (existing.movieId) {
      await prisma.movie.update({
        where: { id: existing.movieId },
        data: { download_links: JSON.stringify(allLinks) }
      }).catch(() => {});
    }
    if (existing.tmdbId) {
      await prisma.mediaCache.updateMany({
        where: { tmdbId: existing.tmdbId },
        data: { download_links: JSON.stringify(allLinks) }
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: 'Download link updated successfully',
      data: updated
    });
  } catch (err) {
    console.error('[ADMIN] Error updating download link:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/admin/download-links/:linkId
 * Delete a specific download link
 */
router.delete('/download-links/:linkId', async (req, res) => {
  try {
    const { linkId } = req.params;

    const existing = await prisma.downloadLink.findUnique({
      where: { id: linkId }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Download link not found' });
    }

    await prisma.downloadLink.delete({
      where: { id: linkId }
    });

    // Sync JSON columns
    const allLinks = await getDownloadLinksForMovie(existing.movieId || existing.tmdbId);
    if (existing.movieId) {
      await prisma.movie.update({
        where: { id: existing.movieId },
        data: { download_links: JSON.stringify(allLinks) }
      }).catch(() => {});
    }
    if (existing.tmdbId) {
      await prisma.mediaCache.updateMany({
        where: { tmdbId: existing.tmdbId },
        data: { download_links: JSON.stringify(allLinks) }
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: 'Download link deleted successfully',
      download_links: allLinks
    });
  } catch (err) {
    console.error('[ADMIN] Error deleting download link:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// AUTOMATION & CRON SYNC ROUTES
// ==============================================================================

/**
 * GET /api/admin/automation/status
 * Get the current status of the movie automation cron and last sync metrics
 */
router.get('/automation/status', async (req, res) => {
  try {
    const { getMovieCronStatus } = await import('./cron/movieSync.js');
    const status = getMovieCronStatus();
    const movieCount = await prisma.movie.count();
    const linkCount = await prisma.downloadLink.count();

    res.json({
      success: true,
      data: {
        ...status,
        database: {
          totalMovies: movieCount,
          totalDownloadLinks: linkCount
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/automation/sync
 * Manually trigger the movie fetching & link extraction job immediately
 */
router.post('/automation/sync', async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.body || {};
    const { runMovieAutomation } = await import('./services/movieAutomation.js');

    // Run sync and await result
    const result = await runMovieAutomation({
      limit: parseInt(limit, 10) || 50,
      page: parseInt(page, 10) || 1
    });

    res.json({
      success: result.status === 'success',
      message: `Sync finished with status: ${result.status}`,
      data: result
    });
  } catch (err) {
    console.error('[ADMIN] Error triggering automation sync:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// TELEGRAM CHANNELS & AUTOMATED IMPORT MANAGEMENT
// ==============================================================================

/**
 * GET /api/admin/channels
 * List all registered Telegram channels with stats and rights status
 */
router.get('/channels', async (req, res) => {
  try {
    const channels = await prisma.telegramSource.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { imports: true },
        },
      },
    });

    res.json({ success: true, data: channels });
  } catch (err) {
    console.error('[ADMIN] Error listing telegram channels:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/channels
 * Register a new authorized Telegram channel
 */
router.post('/channels', async (req, res) => {
  try {
    const {
      channelId,
      channelTitle,
      channelUsername,
      autoImport = true,
      autoPublish = true,
      rightsStatus = 'verified',
      licenseType = 'authorized_redistribution',
      licenseNotes,
    } = req.body;

    if (!channelId) {
      return res.status(400).json({ success: false, message: 'channelId is required' });
    }

    const cleanChannelId = String(channelId).trim();

    // Verify channel access via Telegram Bot API
    let verifiedTitle = channelTitle;
    let verifiedUsername = channelUsername;
    const check = await verifyChannelAccess(cleanChannelId);
    if (check.ok) {
      if (!verifiedTitle && check.title) verifiedTitle = check.title;
      if (!verifiedUsername && check.username) verifiedUsername = check.username;
    }

    const source = await prisma.telegramSource.upsert({
      where: { channelId: cleanChannelId },
      update: {
        channelTitle: verifiedTitle || cleanChannelId,
        channelUsername: verifiedUsername || undefined,
        isAuthorized: true,
        autoImport: Boolean(autoImport),
        autoPublish: Boolean(autoPublish),
        rightsStatus,
        licenseType,
        licenseNotes,
      },
      create: {
        channelId: cleanChannelId,
        channelTitle: verifiedTitle || cleanChannelId,
        channelUsername: verifiedUsername || null,
        isAuthorized: true,
        autoImport: Boolean(autoImport),
        autoPublish: Boolean(autoPublish),
        rightsStatus,
        licenseType,
        licenseNotes,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Channel authorized successfully',
      data: source,
      telegramCheck: check,
    });
  } catch (err) {
    console.error('[ADMIN] Error saving channel:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/admin/channels/:id
 * Update channel settings (auto-import, auto-publish, rights status, etc.)
 */
router.put('/channels/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      channelTitle,
      isAuthorized,
      autoImport,
      autoPublish,
      rightsStatus,
      licenseType,
      licenseNotes,
    } = req.body;

    const updated = await prisma.telegramSource.update({
      where: { id },
      data: {
        ...(channelTitle !== undefined ? { channelTitle } : {}),
        ...(isAuthorized !== undefined ? { isAuthorized: Boolean(isAuthorized) } : {}),
        ...(autoImport !== undefined ? { autoImport: Boolean(autoImport) } : {}),
        ...(autoPublish !== undefined ? { autoPublish: Boolean(autoPublish) } : {}),
        ...(rightsStatus !== undefined ? { rightsStatus } : {}),
        ...(licenseType !== undefined ? { licenseType } : {}),
        ...(licenseNotes !== undefined ? { licenseNotes } : {}),
      },
    });

    res.json({ success: true, message: 'Channel updated successfully', data: updated });
  } catch (err) {
    console.error('[ADMIN] Error updating channel:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/admin/channels/:id
 * Revoke or remove an authorized channel
 */
router.delete('/channels/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.telegramSource.delete({
      where: { id },
    });
    res.json({ success: true, message: 'Channel deleted successfully' });
  } catch (err) {
    console.error('[ADMIN] Error deleting channel:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/channels/:id/verify
 * Re-verify bot access to an authorized channel
 */
router.post('/channels/:id/verify', async (req, res) => {
  try {
    const { id } = req.params;
    const source = await prisma.telegramSource.findUnique({ where: { id } });
    if (!source) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }

    const check = await verifyChannelAccess(source.channelId);
    res.json({ success: true, data: check });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// IMPORT QUEUE & JOBS
// ==============================================================================

/**
 * GET /api/admin/imports
 * List import jobs with optional status filter
 */
router.get('/imports', async (req, res) => {
  try {
    const { status, limit = 50, page = 1 } = req.query;
    const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

    const where = status ? { status: String(status).trim() } : {};

    const [imports, total] = await Promise.all([
      prisma.telegramImport.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
        include: {
          source: true,
          movie: {
            select: { id: true, title: true, posterPath: true, releaseDate: true, status: true },
          },
        },
      }),
      prisma.telegramImport.count({ where }),
    ]);

    res.json({
      success: true,
      data: imports,
      pagination: {
        total,
        page: parseInt(page, 10) || 1,
        limit: take,
        pages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    console.error('[ADMIN] Error listing imports:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/imports/:id/retry
 * Retry a failed or rejected import job
 */
router.post('/imports/:id/retry', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await retryImport(id);
    res.json({ success: result.success, data: result });
  } catch (err) {
    console.error('[ADMIN] Error retrying import:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/imports/:id/publish
 * Approve and publish a movie in 'requires_review' or 'pending' state
 */
router.post('/imports/:id/publish', async (req, res) => {
  try {
    const { id } = req.params;
    const importJob = await prisma.telegramImport.findUnique({
      where: { id },
      include: { movie: true },
    });

    if (!importJob) {
      return res.status(404).json({ success: false, message: 'Import job not found' });
    }

    if (importJob.movieId) {
      await prisma.movie.update({
        where: { id: importJob.movieId },
        data: {
          status: 'ready',
          isPublished: true,
        },
      });
    }

    const updated = await prisma.telegramImport.update({
      where: { id },
      data: { status: 'published' },
    });

    res.json({
      success: true,
      message: 'Movie approved and published successfully',
      data: updated,
    });
  } catch (err) {
    console.error('[ADMIN] Error publishing import:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/imports/:id/reject
 * Reject an import job
 */
router.post('/imports/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await prisma.telegramImport.update({
      where: { id },
      data: {
        status: 'failed',
        errorMessage: 'Rejected by administrator during manual review',
      },
    });
    res.json({ success: true, message: 'Import rejected', data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// MOVIE QUALITY VARIANTS & RIGHTS MANAGEMENT
// ==============================================================================

/**
 * GET /api/admin/movies/:id/variants
 * Get all available quality variants for a movie (480p, 720p, 1080p, 4K)
 */
router.get('/movies/:id/variants', async (req, res) => {
  try {
    const { id } = req.params;
    const variants = await prisma.movieFileVariant.findMany({
      where: { movieId: id },
      orderBy: { quality: 'desc' },
    });

    res.json({ success: true, data: variants });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/admin/variants/:id
 * Remove a specific quality variant
 */
router.delete('/variants/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await removeMovieVariant(id);
    res.json({ success: true, message: 'Variant removed successfully', data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/admin/movies/:id/rights
 * Update movie distribution rights and licensing compliance
 */
router.put('/movies/:id/rights', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      verificationStatus = 'verified',
      licenseType = 'authorized_redistribution',
      rightsGrantedBy,
      notes,
    } = req.body;

    const right = await prisma.movieRight.create({
      data: {
        movieId: id,
        verificationStatus,
        licenseType,
        rightsGrantedBy,
        notes,
      },
    });

    res.json({ success: true, message: 'Rights updated successfully', data: right });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/admin/movies/:id/toggle-publish
 * Toggle public visibility of a movie
 */
router.put('/movies/:id/toggle-publish', async (req, res) => {
  try {
    const { id } = req.params;
    const movie = await prisma.movie.findUnique({ where: { id } });
    if (!movie) {
      return res.status(404).json({ success: false, message: 'Movie not found' });
    }

    const updated = await prisma.movie.update({
      where: { id },
      data: {
        isPublished: !movie.isPublished,
        status: !movie.isPublished ? 'ready' : 'pending',
      },
    });

    res.json({
      success: true,
      message: `Movie is now ${updated.isPublished ? 'Published' : 'Unpublished'}`,
      data: updated,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// TELEGRAM AUTOMATION & DOWNLOAD ANALYTICS
// ==============================================================================

/**
 * GET /api/admin/analytics
 * Comprehensive dashboard overview stats
 */
router.get('/analytics', async (req, res) => {
  try {
    const [
      channelCount,
      importStats,
      totalMovies,
      variants,
      totalDownloads,
      recentImports,
    ] = await Promise.all([
      prisma.telegramSource.count(),
      prisma.telegramImport.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      prisma.movie.count(),
      prisma.movieFileVariant.groupBy({
        by: ['quality'],
        _count: { id: true },
      }),
      prisma.movieDownload.count(),
      prisma.telegramImport.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          source: { select: { channelTitle: true } },
          movie: { select: { title: true } },
        },
      }),
    ]);

    const importStatusMap = {};
    for (const item of importStats) {
      importStatusMap[item.status] = item._count.id;
    }

    const qualityMap = {};
    for (const item of variants) {
      qualityMap[item.quality] = item._count.id;
    }

    res.json({
      success: true,
      data: {
        overview: {
          channels: channelCount,
          movies: totalMovies,
          totalDownloads,
          imports: {
            published: importStatusMap['published'] || 0,
            requires_review: importStatusMap['requires_review'] || 0,
            pending: importStatusMap['pending'] || 0,
            processing: importStatusMap['processing'] || 0,
            failed: importStatusMap['failed'] || 0,
          },
          qualities: qualityMap,
        },
        recentImports,
      },
    });
  } catch (err) {
    console.error('[ADMIN] Error fetching analytics:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/admin/diagnostics
 * Full pipeline health check, diagnostics, and monitoring
 */
router.get('/diagnostics', async (req, res) => {
  const startTime = Date.now();
  try {
    // 1. Check Local Telegram Bot API connectivity
    let localBotApiStatus = {
      connected: false,
      url: config.telegram.localApiUrl,
      botUsername: null,
      latencyMs: null,
      error: null,
    };

    if (config.telegram.botToken) {
      try {
        const pingStart = Date.now();
        const pingRes = await axios.get(`${config.telegram.localApiUrl}/bot${config.telegram.botToken}/getMe`, { timeout: 5000 });
        localBotApiStatus = {
          connected: Boolean(pingRes.data?.ok),
          url: config.telegram.localApiUrl,
          botUsername: pingRes.data?.result?.username || null,
          latencyMs: Date.now() - pingStart,
          error: pingRes.data?.ok ? null : (pingRes.data?.description || 'Failed getMe'),
        };
      } catch (pingErr) {
        localBotApiStatus.error = pingErr.message;
      }
    } else {
      localBotApiStatus.error = 'TELEGRAM_BOT_TOKEN is not configured';
    }

    // 1b. Check Telegram MTProto Userbot Client status
    let userbotStatus = {
      connected: false,
      apiIdConfigured: Boolean(config.telegram.apiId),
      stringSessionConfigured: Boolean(config.telegram.stringSession),
      error: null,
    };
    try {
      const ubClient = await getUserbotClient().catch((e) => {
        userbotStatus.error = e.message;
        return null;
      });
      if (ubClient) {
        userbotStatus.connected = Boolean(ubClient.connected);
      }
    } catch (ubErr) {
      userbotStatus.error = ubErr.message;
    }

    // 1c. Check Destination Channel access
    let destinationChannelStatus = {
      configured: Boolean(config.telegram.chatId),
      chatId: config.telegram.chatId || null,
      accessible: false,
      title: null,
      error: null,
    };
    if (config.telegram.chatId) {
      try {
        const destCheck = await verifyChannelAccess(config.telegram.chatId);
        destinationChannelStatus.accessible = Boolean(destCheck?.ok);
        destinationChannelStatus.title = destCheck?.title || null;
        destinationChannelStatus.error = destCheck?.error || null;
      } catch (destErr) {
        destinationChannelStatus.error = destErr.message;
      }
    } else {
      destinationChannelStatus.error = 'TELEGRAM_CHAT_ID is not configured';
    }

    // 2. Test Download Endpoint Health (token crypto check)
    let downloadHealth = {
      status: 'healthy',
      signingSecretConfigured: Boolean(process.env.DOWNLOAD_SIGNING_SECRET || process.env.JWT_SECRET),
      tokenGenerationValid: false,
      deliveryReadiness: {
        modeA_telegramRedirect: Boolean(destinationChannelStatus.accessible),
        modeB_websiteDirectStream: Boolean(localBotApiStatus.connected || userbotStatus.connected),
      },
      buttonVisibilityDiagnostics: {
        primaryButtons: 'Always active. DownloadButton (cloud DDL options) and DirectStreamButton (browser direct stream) are never gated by Telegram sync.',
        telegramVariants: 'Rendered independently per verified quality variant (480p, 720p, 1080p, 4K) as soon as imported.',
        processingPlaceholder: 'Permanent placeholder eliminated; subtle indicator only shown during active sync.',
      },
    };
    try {
      const testToken = generateSignedDownloadToken({ variantId: 'diag-test', quality: '1080p', ttlSeconds: 60 });
      const verifyCheck = verifySignedDownloadToken(testToken.token);
      downloadHealth.tokenGenerationValid = Boolean(verifyCheck?.valid);
    } catch (tokenErr) {
      downloadHealth.status = 'degraded';
      downloadHealth.error = tokenErr.message;
    }

    // 3. Database queries for pipeline metrics
    const [
      channels,
      lastUpdate,
      lastSuccess,
      pendingImports,
      failedImports,
      variantsByQuality,
      recentVariants,
    ] = await Promise.all([
      // Connected Telegram Channels
      prisma.telegramSource.findMany({
        orderBy: { createdAt: 'desc' },
      }),
      // Last received update
      prisma.telegramImport.findFirst({
        orderBy: { createdAt: 'desc' },
        include: { source: { select: { channelTitle: true } }, movie: { select: { title: true } } },
      }),
      // Last successful import
      prisma.telegramImport.findFirst({
        where: { OR: [{ status: 'published' }, { status: 'verified' }] },
        orderBy: { updatedAt: 'desc' },
        include: { source: { select: { channelTitle: true } }, movie: { select: { title: true } } },
      }),
      // Pending / Processing imports
      prisma.telegramImport.findMany({
        where: { OR: [{ status: 'pending' }, { status: 'processing' }] },
        orderBy: { createdAt: 'asc' },
      }),
      // Failed imports
      prisma.telegramImport.findMany({
        where: { status: 'failed' },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        include: { source: { select: { channelTitle: true } } },
      }),
      // Variants by quality
      prisma.movieFileVariant.groupBy({
        by: ['quality'],
        _count: { id: true },
      }),
      // Recent movie variants
      prisma.movieFileVariant.findMany({
        take: 15,
        orderBy: { createdAt: 'desc' },
        include: { movie: { select: { title: true, tmdbId: true } } },
      }),
    ]);

    const qualityCounts = {};
    for (const q of variantsByQuality) {
      qualityCounts[q.quality] = q._count.id;
    }

    res.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        localBotApi: localBotApiStatus,
        userbot: userbotStatus,
        destinationChannel: destinationChannelStatus,
        downloadHealth,
        channels: {
          total: channels.length,
          authorized: channels.filter((c) => c.isAuthorized).length,
          list: channels,
        },
        pipeline: {
          lastReceivedUpdate: lastUpdate,
          lastSuccessfulImport: lastSuccess,
          pendingCount: pendingImports.length,
          pendingList: pendingImports,
          failedCount: failedImports.length,
          failedList: failedImports,
        },
        variants: {
          counts: qualityCounts,
          recent: recentVariants,
        },
      },
    });
  } catch (err) {
    console.error('[ADMIN] Error in /diagnostics:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;


