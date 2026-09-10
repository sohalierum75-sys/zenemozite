// ==============================================================================
// Telegram Invisible CDN — chunker
//
// DESIGN: BYTE-LEVEL splitting via native fs.ReadStream ranges (NOT ffmpeg).
//
// ffmpeg splits by TIME, producing independently-encoded video segments.
// Concatenating the raw bytes of ffmpeg segments does NOT produce a valid
// playable file. Byte-level splitting via native ReadStreams produces chunks
// that, when concatenated in order, are BYTE-IDENTICAL to the original file —
// exactly what the sequential HTTP streaming download requires.
// ==============================================================================
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import prisma from '../prisma/client.js';
import { config, formatBytes } from './config.js';
import * as telegramStore from './telegramStore.js';

/**
 * Copy the byte range [start..end] of filePath into its own file (pure disk
 * I/O, 1MB buffers) so it can be handed to the Local Bot API via file://.
 * A ranged byte-range can't be expressed as a file:// URI — splicing gives
 * each chunk its own real file without ever holding chunk data in RAM.
 */
async function spliceRange(filePath, start, end, outPath) {
  await new Promise((resolve, reject) => {
    const rs = fs.createReadStream(filePath, { start, end, highWaterMark: 1024 * 1024 });
    const ws = fs.createWriteStream(outPath);
    ws.once('finish', resolve);
    ws.once('error', reject);
    rs.once('error', reject);
    rs.pipe(ws); // pipe = built-in backpressure handling
  });
}

/**
 * Spool an incoming Readable stream to a temp file so we can perform
 * ranged reads for chunking. (Needed when the torrent logic provides a
 * live stream rather than a file on disk.) Prefers the shared telegram-api
 * volume so the spooled file can also be uploaded via file:// later.
 * @returns {Promise<string>} the temp file path
 */
export async function spoolToTemp(sourceStream) {
  const dir = config.telegram.sharedDir || os.tmpdir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  const tmpPath = path.join(
    dir,
    `zinemo-cache-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const writeStream = fs.createWriteStream(tmpPath);
  await new Promise((resolve, reject) => {
    sourceStream.pipe(writeStream);
    sourceStream.once('error', reject);
    writeStream.once('error', reject);
    writeStream.once('finish', resolve);
  });
  return tmpPath;
}

/**
 * Split a file into byte-range chunks and upload each to Telegram sequentially.
 * Saves one MovieChunk row per chunk (ordered by chunkIndex).
 *
 * @param {string} filePath — path to the complete file on disk
 * @param {{ movieId: string, title: string, fileName?: string, mimeType?: string }} opts
 * @returns {{ chunkCount: number, totalSize: number }}
 */
export async function splitAndUpload(filePath, { movieId, title, fileName, mimeType } = {}) {
  const stat = await fs.promises.stat(filePath);
  const totalSize = stat.size;
  const chunkSize = config.telegram.chunkSizeBytes;
  const chunkCount = Math.max(1, Math.ceil(totalSize / chunkSize));

  // Mark as caching + store the actual size
  await prisma.movie.update({
    where: { id: movieId },
    data: { status: 'caching', sizeBytes: totalSize },
  });

  // Clear any stale chunks from a previous attempt
  await prisma.movieChunk.deleteMany({ where: { movieId } });

  const safeName = fileName || `${title}.mp4`;
  const ext = path.extname(safeName) || '.mp4';
  const stem = path.basename(safeName, ext);

  // file:// (zero-RAM) uploads are only possible when the file — or its
  // spliced part files — live in the shared telegram-api volume.
  const canFileUri = Boolean(config.telegram.sharedDir);

  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize;
    const end = Math.min((i + 1) * chunkSize, totalSize) - 1;
    const thisSize = end - start + 1;

    const partName = chunkCount > 1
      ? `${stem}.part${String(i + 1).padStart(2, '0')}${ext}`
      : safeName;

    console.log(`[CHUNKER] Uploading chunk ${i + 1}/${chunkCount} (${formatBytes(thisSize)}) -> Telegram`);

    let readStream = null;
    let partPath = null;
    try {
      let result;
      if (canFileUri) {
        // ZERO-RAM path: hand the Local Bot API a file:// path on the shared
        // volume — the API server reads the bytes from its own disk. Single-
        // chunk files are handed as-is; multi-chunk files get each byte
        // range spliced to its own part file (pure disk I/O, 1MB buffers),
        // then the part file is deleted immediately after upload.
        if (chunkCount === 1) {
          result = await telegramStore.uploadFileFromDisk(filePath, { fileName: partName, caption: title });
        } else {
          partPath = path.join(
            config.telegram.sharedDir,
            `.chunk-${String(movieId || 'x').slice(0, 8)}-${i + 1}-${Date.now()}${ext}`
          );
          await spliceRange(filePath, start, end, partPath);
          result = await telegramStore.uploadFileFromDisk(partPath, { fileName: partName, caption: title });
        }
      } else {
        // STREAMING fallback (still low-RAM, used when TELEGRAM_SHARED_DIR is
        // not configured): pipe the byte range straight into the HTTP request
        // in 4MB slices via form.submit() — never a whole-chunk RAM buffer.
        readStream = fs.createReadStream(filePath, {
          start,
          end,
          highWaterMark: config.telegram.uploadHighWaterMarkBytes,
        });
        result = await telegramStore.uploadStream(readStream, {
          fileName: partName,
          caption: title,
          knownLength: thisSize, // exact Content-Length, no stream probing
        });
      }
      const fileId = result.fileId;

      await prisma.movieChunk.create({
        data: {
          movieId,
          chunkIndex: i,
          telegramFileId: fileId,
          chunkSize: thisSize,
        },
      });

      console.log(`[CHUNKER] Chunk ${i + 1}/${chunkCount} saved (file_id: ${fileId})`);
    } finally {
      // HARD CLEANUP after every chunk: delete the spliced part file, destroy
      // the reader (releases fd + highWaterMark window), drop references, and
      // hint the GC (--expose-gc is enabled in entrypoint.sh) so multipart
      // scratch buffers never linger into the next chunk's upload.
      if (partPath) fs.promises.unlink(partPath).catch(() => {});
      if (readStream && typeof readStream.destroy === 'function' && !readStream.destroyed) {
        readStream.destroy();
      }
      readStream = null;
      if (typeof global.gc === 'function') global.gc();
    }
  }

  await prisma.movie.update({
    where: { id: movieId },
    data: { status: 'ready' },
  });

  console.log(`[CHUNKER] DONE: ${chunkCount} chunk(s) for "${title}" (${formatBytes(totalSize)})`);
  return { chunkCount, totalSize };
}

/**
 * Create a single Readable that yields all chunks of a movie in order.
 * Data flows: Telegram Local API -> PassThrough -> (piped to HTTP response by caller)
 *
 * All Telegram file_paths are resolved in parallel upfront (fast) before any
 * data flows, so a bad file_id fails cleanly before the download starts.
 *
 * @param {Array<{ telegramFileId: string }>} chunks — ordered by chunkIndex
 * @returns {import('stream').Readable}
 */
export function createChunkStream(chunks) {
  const output = new PassThrough();
  let paths = null;
  let index = 0;
  let destroyed = false;
  let currentStream = null;

  // Pre-resolve all file paths in parallel (before any data flows)
  Promise.all(chunks.map((c) => telegramStore.getFilePath(c.telegramFileId)))
    .then((resolved) => {
      if (destroyed) return;
      paths = resolved;
      pipeNext();
    })
    .catch((err) => {
      if (!destroyed) output.destroy(err);
    });

  function pipeNext() {
    if (destroyed) return;
    if (index >= paths.length) {
      output.end();
      return;
    }

    telegramStore
      .openFileStream(paths[index])
      .then((readable) => {
        if (destroyed) {
          readable.destroy();
          return;
        }
        currentStream = readable;
        readable.pipe(output, { end: false });
        readable.once('end', () => {
          currentStream = null;
          pipeNext();
        });
        readable.once('error', (err) => {
          currentStream = null;
          if (!destroyed) {
            destroyed = true;
            output.destroy(err);
          }
        });
      })
      .catch((err) => {
        if (!destroyed) {
          destroyed = true;
          output.destroy(err);
        }
      });
  }

  // If the HTTP response is destroyed (client disconnect), stop pulling from Telegram
  output.once('close', () => {
    destroyed = true;
    if (currentStream) currentStream.destroy();
  });

  return output;
}