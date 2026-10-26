import express from 'express';
import prisma from './prisma/client.js';

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
        download_links: links
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
            download_links: links
          }
        });
      }
      return res.status(404).json({ success: false, message: 'Movie not found' });
    }

    res.json({
      success: true,
      data: {
        ...movie,
        download_links: links
      }
    });
  } catch (err) {
    console.error('[ADMIN] Error fetching movie:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/movies
 * Create or save a movie with direct download links
 */
router.post('/movies', async (req, res) => {
  try {
    const {
      title,
      tmdbId,
      posterPath,
      backdropPath,
      releaseDate,
      download_links = []
    } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }

    const tmdbIdInt = tmdbId ? parseInt(tmdbId, 10) : null;
    const linksArray = Array.isArray(download_links) ? download_links : [];

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
          download_links: JSON.stringify(linksArray)
        },
        create: {
          title,
          tmdbId: tmdbIdInt,
          posterPath: posterPath || null,
          backdropPath: backdropPath || null,
          releaseDate: releaseDate || null,
          download_links: JSON.stringify(linksArray),
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
        data: { download_links: JSON.stringify(linksArray) }
      }).catch(() => {});
    }

    const savedLinks = await getDownloadLinksForMovie(movie.id);

    res.status(201).json({
      success: true,
      message: 'Movie and download links saved successfully',
      data: {
        ...movie,
        download_links: savedLinks
      }
    });
  } catch (err) {
    console.error('[ADMIN] Error creating movie:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/admin/movies/:id
 * Update movie and replace/sync direct download links
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
      download_links
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

    if (existingMovie) {
      updatedMovie = await prisma.movie.update({
        where: { id: existingMovie.id },
        data: {
          title: title || existingMovie.title,
          posterPath: posterPath !== undefined ? posterPath : existingMovie.posterPath,
          backdropPath: backdropPath !== undefined ? backdropPath : existingMovie.backdropPath,
          releaseDate: releaseDate !== undefined ? releaseDate : existingMovie.releaseDate,
          download_links: linksArray !== null ? JSON.stringify(linksArray) : existingMovie.download_links
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
    if (tmdbIdRef && linksArray !== null) {
      await prisma.mediaCache.updateMany({
        where: { tmdbId: String(tmdbIdRef) },
        data: { download_links: JSON.stringify(linksArray) }
      }).catch(() => {});
    }

    const currentLinks = await getDownloadLinksForMovie(updatedMovie.id);

    res.json({
      success: true,
      message: 'Movie updated successfully',
      data: {
        ...updatedMovie,
        download_links: currentLinks
      }
    });
  } catch (err) {
    console.error('[ADMIN] Error updating movie:', err);
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

export default router;

