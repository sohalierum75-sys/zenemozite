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
 * Spool an incoming Readable stream to a temp file so we can perform
 * ranged reads for chunking. (Needed when the torrent logic provides a
 * live stream rather than a file on disk.)
 * @returns {Promise<string>} the temp file path
 */
export async function spoolToTemp(sourceStream) {
  const tmpPath = path.join(
    os.tmpdir(),
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

  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize;
    const end = Math.min((i + 1) * chunkSize, totalSize) - 1;
    const thisSize = end - start + 1;

    const partName = chunkCount > 1
      ? `${stem}.part${String(i + 1).padStart(2, '0')}${ext}`
      : safeName;

    console.log(`[CHUNKER] Uploading chunk ${i + 1}/${chunkCount} (${formatBytes(thisSize)}) -> Telegram`);

    // Byte-range read: this is the key — each ReadStream reads exactly
    // the [start..end] window from the file, producing byte-identical chunks.
    const readStream = fs.createReadStream(filePath, { start, end });

    const { fileId } = await telegramStore.uploadStream(readStream, {
      fileName: partName,
      caption: title,
    });

    await prisma.movieChunk.create({
      data: {
        movieId,
        chunkIndex: i,
        telegramFileId: fileId,
        chunkSize: thisSize,
      },
    });

    console.log(`[CHUNKER] Chunk ${i + 1}/${chunkCount} saved (file_id: ${fileId})`);
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