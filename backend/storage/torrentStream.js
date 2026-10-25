// ==============================================================================
// On-the-fly Torrent Streamer (WebTorrent)
// Used as immediate streaming fallback when a movie is not yet cached in Telegram.
// Pipes torrent video bytes directly to Express HTTP response with Zero-RAM,
// Range request support (HTTP 206), and Content-Disposition: attachment.
// ==============================================================================
import { pipeline } from 'stream/promises';
import WebTorrent from 'webtorrent';

let client = null;

function getTorrentClient() {
  if (!client) {
    client = new WebTorrent({
      maxConns: 30,
    });
    client.on('error', (err) => {
      console.warn('[TORRENT_STREAM] WebTorrent error:', err.message);
    });
  }
  return client;
}

/**
 * Stream a video file from a magnet link directly to an Express HTTP response.
 */
export async function streamTorrentFile({ magnetLink, req, res, fileName }) {
  const wt = getTorrentClient();

  // In WebTorrent v3, client.get() and client.add() return Promises
  let torrent = await wt.get(magnetLink);
  if (!torrent) {
    try {
      torrent = await wt.add(magnetLink);
    } catch (addErr) {
      // If already added or parallel add in flight, retry get
      torrent = await wt.get(magnetLink);
      if (!torrent) throw addErr;
    }
  }

  // Ensure torrent metadata is ready
  if (!torrent.ready) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Torrent metadata timeout — no peers found to stream file.'));
      }, 45000);

      const onReady = () => {
        clearTimeout(timeout);
        torrent.removeListener('error', onError);
        resolve();
      };
      const onError = (err) => {
        clearTimeout(timeout);
        torrent.removeListener('ready', onReady);
        reject(err);
      };

      torrent.once('ready', onReady);
      torrent.once('error', onError);
    });
  }

  if (!torrent.files || torrent.files.length === 0) {
    throw new Error('No files found in torrent.');
  }

  // Pick largest file (the video)
  const file = torrent.files.reduce((max, f) => (f.length > max.length ? f : max), torrent.files[0]);
  const fileSize = file.length;
  const outName = fileName || file.name || 'download.mp4';
  const safeName = outName.replace(/[^\w.\- ]/g, '_');

  const range = req.headers.range;
  let start = 0;
  let end = fileSize - 1;
  let statusCode = 200;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const rawStart = parseInt(parts[0], 10);
    const rawEnd = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    start = !isNaN(rawStart) ? Math.max(0, rawStart) : 0;
    end = !isNaN(rawEnd) ? Math.min(rawEnd, fileSize - 1) : fileSize - 1;

    if (start >= fileSize || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      return res.end();
    }

    statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
  }

  const contentLength = end - start + 1;

  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', String(contentLength));
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache');
  res.status(statusCode);

  console.log(`[TORRENT_STREAM] Streaming "${safeName}" (${contentLength} bytes) directly to client`);

  const fileStream = file.createReadStream({ start, end });

  req.once('close', () => {
    if (!fileStream.destroyed && fileStream.destroy) fileStream.destroy();
  });

  try {
    await pipeline(fileStream, res);
    console.log(`[TORRENT_STREAM] Completed streaming "${safeName}"`);
  } catch (err) {
    if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      console.log(`[TORRENT_STREAM] Torrent download cancelled by client for "${safeName}"`);
      return;
    }
    console.error(`[TORRENT_STREAM] Error streaming "${safeName}":`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: err.message });
    }
    res.destroy();
  }
}
