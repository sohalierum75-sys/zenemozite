import axios from 'axios';
import path from 'path';
import fs from 'fs';
import prisma from '../prisma/client.js';
import { config } from '../storage/config.js';
import { getFileInfo, resolveLocalDiskPath } from '../storage/telegramStore.js';
import { parseTelegramFiles } from '../storage/telegramParser.js';
import {
  extractMetadataFromText,
  verifyResolutionWithFFprobe,
  searchTMDBMovie,
  matchExistingMovie,
  normalizeTitle,
  formatBytes
} from './movieDetector.js';

const apiBase = () => `${config.telegram.localApiUrl}/bot${config.telegram.botToken}`;

/**
 * Secret token used for Telegram Webhook authenticity verification
 */
export const WEBHOOK_SECRET_TOKEN = (
  process.env.TELEGRAM_WEBHOOK_SECRET ||
  process.env.WEBHOOK_SECRET ||
  'zinemo_telegram_sec_token_2026'
).trim();

/**
 * Verifies that the bot has access to a specific Telegram channel
 * Calls Telegram getChat and getChatMember APIs
 *
 * @param {string|number} channelId
 * @returns {Promise<{ ok: boolean, title?: string, username?: string, error?: string }>}
 */
export async function verifyChannelAccess(channelId) {
  if (!config.telegram.botToken) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' };
  }

  const cleanId = String(channelId).trim();
  try {
    const res = await axios.get(`${apiBase()}/getChat`, {
      params: { chat_id: cleanId },
      timeout: 10000,
    });

    if (!res.data?.ok || !res.data?.result) {
      return { ok: false, error: res.data?.description || 'Failed to inspect channel' };
    }

    const chat = res.data.result;

    // Check bot membership / admin status
    let isMember = true;
    try {
      const meRes = await axios.get(`${apiBase()}/getMe`, { timeout: 8000 });
      const botId = meRes.data?.result?.id;
      if (botId) {
        const memberRes = await axios.get(`${apiBase()}/getChatMember`, {
          params: { chat_id: cleanId, user_id: botId },
          timeout: 8000,
        });
        const status = memberRes.data?.result?.status;
        isMember = ['creator', 'administrator', 'member'].includes(status);
      }
    } catch (mErr) {
      // In some public channels getChatMember may have restricted visibility,
      // but getChat succeeding means access is valid.
      console.warn(`[TELEGRAM_VERIFY] getChatMember check notice for ${cleanId}:`, mErr.message);
    }

    return {
      ok: true,
      title: chat.title || chat.username || cleanId,
      username: chat.username || null,
      type: chat.type,
      isMember,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.response?.data?.description || err.message,
    };
  }
}

/**
 * Registers or updates the webhook URL with Telegram Bot API
 *
 * @param {string} webhookUrl - Public URL, e.g. https://zinemo.com/api/telegram/webhook
 * @returns {Promise<{ success: boolean, description: string }>}
 */
export async function registerWebhook(webhookUrl) {
  if (!config.telegram.botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  }

  const payload = {
    url: webhookUrl,
    secret_token: WEBHOOK_SECRET_TOKEN,
    allowed_updates: ['channel_post', 'message'],
    drop_pending_updates: false,
  };

  const res = await axios.post(`${apiBase()}/setWebhook`, payload, { timeout: 15000 });
  return {
    success: Boolean(res.data?.ok),
    description: res.data?.description || (res.data?.ok ? 'Webhook registered successfully' : 'Failed'),
  };
}

/**
 * Get current Telegram webhook status from Telegram API
 */
export async function getWebhookInfo() {
  if (!config.telegram.botToken) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' };
  }

  try {
    const res = await axios.get(`${apiBase()}/getWebhookInfo`, { timeout: 10000 });
    return res.data;
  } catch (err) {
    return { ok: false, error: err.response?.data?.description || err.message };
  }
}

/**
 * Core Automated Import Pipeline:
 * Processes an incoming Telegram channel post or uploaded message
 *
 * @param {object} message - Telegram Message / ChannelPost object
 * @param {number} [updateId] - Telegram update_id
 * @returns {Promise<{ success: boolean, status: string, movieId?: string, variantId?: string, reason?: string }>}
 */
export async function processIncomingTelegramPost(message, updateId = null) {
  if (!message || typeof message !== 'object') {
    return { success: false, status: 'ignored', reason: 'Empty or invalid message' };
  }

  const chat = message.chat || {};
  const channelId = String(chat.id || message.chat_id || '');
  const messageId = parseInt(message.message_id, 10);

  if (!channelId || !messageId) {
    return { success: false, status: 'ignored', reason: 'Missing channelId or messageId' };
  }

  // 1. Identify File / Document attachment
  const doc = message.document || message.video || message.audio;
  if (!doc || !doc.file_id) {
    console.log(`[TELEGRAM_IMPORT] Post in ${channelId} msg #${messageId} has no video/document file - ignored.`);
    return { success: false, status: 'ignored', reason: 'Post contains no video/document file' };
  }

  const fileId = doc.file_id;
  const fileUniqueId = doc.file_unique_id || null;
  const rawFileName = doc.file_name || `${fileId.slice(-8)}.mp4`;
  const fileSize = doc.file_size ? Number(doc.file_size) : null;
  const mimeType = doc.mime_type || (message.video ? 'video/mp4' : 'application/octet-stream');
  const caption = message.caption || message.text || '';

  console.log(`\n======================================================`);
  console.log(`[TELEGRAM_IMPORT] Detected post in channel ${channelId} msg #${messageId}`);
  console.log(`[TELEGRAM_IMPORT] File: "${rawFileName}" (${formatBytes(fileSize) || 'Unknown size'})`);
  console.log(`======================================================`);

  // 2. Validate Source Authorization
  // Rule: Auto-import is allowed ONLY for authorized channels registered in database
  const normalizedChannelId = channelId.replace(/^-100/, '');
  let source = await prisma.telegramSource.findFirst({
    where: {
      OR: [
        { channelId },
        { channelId: `-100${normalizedChannelId}` },
        { channelId: normalizedChannelId }
      ]
    },
  });

  if (!source) {
    // If channel isn't registered, check if it matches the configured TELEGRAM_CHAT_ID (backward compatibility)
    const configCleanId = config.telegram.chatId ? String(config.telegram.chatId).replace(/^-100/, '') : '';
    if (configCleanId && normalizedChannelId === configCleanId) {
      source = await prisma.telegramSource.create({
        data: {
          channelId,
          channelTitle: chat.title || 'Default Primary Channel',
          channelUsername: chat.username || null,
          isAuthorized: true,
          autoImport: true,
          autoPublish: true,
          rightsStatus: 'verified',
          licenseType: 'authorized_primary_cdn',
        },
      });
      console.log(`[TELEGRAM_IMPORT] Auto-registered primary configured channel ${channelId}`);
    } else {
      console.warn(`[TELEGRAM_IMPORT] REJECTED: Channel ${channelId} is NOT in the authorized sources list.`);
      return {
        success: false,
        status: 'unauthorized_source',
        reason: `Channel ${channelId} is not registered or authorized by admin.`,
      };
    }
  }

  if (!source.isAuthorized) {
    console.warn(`[TELEGRAM_IMPORT] REJECTED: Channel ${channelId} ("${source.channelTitle}") authorization is disabled.`);
    return {
      success: false,
      status: 'unauthorized_source',
      reason: 'Channel authorization is disabled.',
    };
  }

  // Update lastPostAt
  await prisma.telegramSource.update({
    where: { id: source.id },
    data: { lastPostAt: new Date() },
  }).catch(() => {});

  // 3. Verify Redistribution Rights
  // Rule: Do not bypass copyright protections; reject if rights are expired or revoked
  const isRightsVerified = source.rightsStatus === 'verified';
  if (source.rightsStatus === 'revoked' || source.rightsStatus === 'expired') {
    console.warn(`[TELEGRAM_IMPORT] REJECTED: Channel ${channelId} rights status is "${source.rightsStatus}".`);
    return {
      success: false,
      status: 'rights_invalid',
      reason: `Channel redistribution rights are ${source.rightsStatus}.`,
    };
  }

  // 4. Deduplicate Import Job
  let importJob = await prisma.telegramImport.findUnique({
    where: {
      sourceChannelId_messageId: {
        sourceChannelId: channelId,
        messageId,
      },
    },
  });

  if (importJob && (importJob.status === 'published' || importJob.status === 'verified')) {
    console.log(`[TELEGRAM_IMPORT] Update #${messageId} already processed with status "${importJob.status}".`);
    return {
      success: true,
      status: 'already_processed',
      movieId: importJob.movieId,
    };
  }

  if (!importJob) {
    importJob = await prisma.telegramImport.create({
      data: {
        sourceChannelId: channelId,
        messageId,
        updateId: updateId ? parseInt(updateId, 10) : null,
        fileId,
        fileUniqueId,
        fileName: rawFileName,
        fileSizeBytes: fileSize,
        mimeType,
        caption,
        status: 'processing',
      },
    });
  } else {
    importJob = await prisma.telegramImport.update({
      where: { id: importJob.id },
      data: {
        status: 'processing',
        fileId,
        fileUniqueId,
        fileName: rawFileName,
        fileSizeBytes: fileSize,
      },
    });
  }

  try {
    // 5. Read File Metadata & Detect Resolution
    const parsedMeta = extractMetadataFromText(rawFileName, caption, fileSize);
    console.log(`[TELEGRAM_IMPORT] Parsed: Title="${parsedMeta.title}" Year=${parsedMeta.year} Quality=${parsedMeta.quality} Codec=${parsedMeta.codec || 'N/A'}`);

    let detectedQuality = parsedMeta.quality;
    let verifiedResolution = false;
    let streamWidth = null;
    let streamHeight = null;
    let detectedCodec = parsedMeta.codec;

    // 6. FFprobe Resolution Verification (if Local Bot API storage path is accessible)
    try {
      const fileInfo = await getFileInfo(fileId).catch(() => null);
      if (fileInfo?.filePath) {
        const localPath = resolveLocalDiskPath(fileInfo.filePath);
        if (localPath && fs.existsSync(localPath)) {
          const probe = await verifyResolutionWithFFprobe(localPath);
          if (probe.verified && probe.quality) {
            console.log(`[TELEGRAM_IMPORT] FFprobe VERIFIED resolution: ${probe.width}x${probe.height} -> ${probe.quality} (${probe.codec})`);
            detectedQuality = probe.quality;
            verifiedResolution = true;
            streamWidth = probe.width;
            streamHeight = probe.height;
            if (probe.codec) detectedCodec = probe.codec;
          }
        }
      }
    } catch (probeErr) {
      console.warn('[TELEGRAM_IMPORT] Probe check notice:', probeErr.message);
    }

    // 7. TMDB Metadata Lookup
    const tmdbMeta = await searchTMDBMovie(parsedMeta.title, parsedMeta.year);
    if (tmdbMeta) {
      console.log(`[TELEGRAM_IMPORT] Matched TMDB: "${tmdbMeta.title}" (${tmdbMeta.releaseDate}) [TMDB ID: ${tmdbMeta.tmdbId}]`);
    }

    // 8. Match Existing Movie in Database (Prevent duplicates across 720p/1080p/4K)
    const matchResult = await matchExistingMovie(parsedMeta, tmdbMeta);
    let movie = matchResult.movie;

    const movieTitle = tmdbMeta?.title || parsedMeta.title;
    const releaseDate = tmdbMeta?.releaseDate || (parsedMeta.year ? String(parsedMeta.year) : null);
    const normalizedMovieTitle = normalizeTitle(movieTitle);

    // 9. Create or Update Movie Record
    if (!movie) {
      console.log(`[TELEGRAM_IMPORT] Creating new Movie record for "${movieTitle}"...`);
      movie = await prisma.movie.create({
        data: {
          title: movieTitle,
          normalizedTitle: normalizedMovieTitle,
          tmdbId: tmdbMeta?.tmdbId ? parseInt(tmdbMeta.tmdbId, 10) : null,
          posterPath: tmdbMeta?.posterPath || null,
          backdropPath: tmdbMeta?.backdropPath || null,
          voteAverage: tmdbMeta?.voteAverage || null,
          releaseDate: releaseDate || null,
          popularity: tmdbMeta?.popularity || null,
          genreIds: tmdbMeta?.genreIds || null,
          sizeBytes: fileSize,
          fileName: rawFileName,
          mimeType,
          status: 'ready',
          isPublished: source.autoPublish && isRightsVerified,
        },
      });
    } else {
      console.log(`[TELEGRAM_IMPORT] Found existing Movie record "${movie.title}" (ID: ${movie.id}). Linking new variant.`);
      // Update movie with TMDB data if missing
      await prisma.movie.update({
        where: { id: movie.id },
        data: {
          normalizedTitle: normalizedMovieTitle,
          ...(tmdbMeta?.posterPath && !movie.posterPath ? { posterPath: tmdbMeta.posterPath } : {}),
          ...(tmdbMeta?.backdropPath && !movie.backdropPath ? { backdropPath: tmdbMeta.backdropPath } : {}),
          ...(tmdbMeta?.tmdbId && !movie.tmdbId ? { tmdbId: parseInt(tmdbMeta.tmdbId, 10) } : {}),
          ...(releaseDate && !movie.releaseDate ? { releaseDate } : {}),
        },
      });
    }

    // 8. Verify file can be served by Telegram Local Bot API before marking available
    let canBeServed = false;
    try {
      const fileInfo = await getFileInfo(fileId).catch(() => null);
      if (fileInfo && fileInfo.filePath) {
        canBeServed = true;
      }
    } catch {
      canBeServed = false;
    }

    if (!canBeServed) {
      console.warn(`[TELEGRAM_IMPORT] File ${fileId} cannot be served by Telegram Local Bot API. Marking variant unavailable.`);
    }

    // 10. Attach / Upsert Multi-Quality Download Variant
    const variant = await prisma.movieFileVariant.upsert({
      where: {
        movieId_quality: {
          movieId: movie.id,
          quality: detectedQuality,
        },
      },
      update: {
        telegramFileId: fileId,
        telegramFileUniqueId: fileUniqueId,
        telegramMessageId: messageId,
        sourceChannelId: channelId,
        fileName: rawFileName,
        fileSizeBytes: fileSize,
        fileSizeFormatted: formatBytes(fileSize),
        mimeType,
        width: streamWidth,
        height: streamHeight,
        codec: detectedCodec,
        audioLanguage: parsedMeta.audioLanguage,
        subtitleInfo: parsedMeta.subtitleInfo,
        verifiedResolution,
        isAvailable: canBeServed,
      },
      create: {
        movieId: movie.id,
        quality: detectedQuality,
        telegramFileId: fileId,
        telegramFileUniqueId: fileUniqueId,
        telegramMessageId: messageId,
        sourceChannelId: channelId,
        fileName: rawFileName,
        fileSizeBytes: fileSize,
        fileSizeFormatted: formatBytes(fileSize),
        mimeType,
        width: streamWidth,
        height: streamHeight,
        codec: detectedCodec,
        audioLanguage: parsedMeta.audioLanguage,
        subtitleInfo: parsedMeta.subtitleInfo,
        verifiedResolution,
        isAvailable: canBeServed,
      },
    });

    console.log(`[TELEGRAM_IMPORT] Attached quality variant "${detectedQuality}" to movie "${movie.title}".`);

    // 11. Sync Movie.telegram_files JSON Column
    // This guarantees existing frontend and legacy endpoints immediately reflect the new quality
    const allVariants = await prisma.movieFileVariant.findMany({
      where: { movieId: movie.id, isAvailable: true },
    });

    const QUALITY_ORDER = { '4K': 4, '2160p': 4, '1080p': 3, '720p': 2, '480p': 1 };
    const tgFilesArray = allVariants
      .map((v) => ({
        file_id: v.telegramFileId,
        quality: v.quality,
        size: v.fileSizeFormatted || formatBytes(v.fileSizeBytes) || 'Unknown',
        fileName: v.fileName,
        audioLanguage: v.audioLanguage,
        verified: v.verifiedResolution,
      }))
      .sort((a, b) => (QUALITY_ORDER[b.quality] || 0) - (QUALITY_ORDER[a.quality] || 0));

    await prisma.movie.update({
      where: { id: movie.id },
      data: {
        telegram_files: JSON.stringify(tgFilesArray),
      },
    });

    // Also sync MediaCache if it exists for this tmdbId
    if (movie.tmdbId) {
      await prisma.mediaCache.updateMany({
        where: { tmdbId: String(movie.tmdbId) },
        data: {
          telegram_files: JSON.stringify(tgFilesArray),
        },
      }).catch(() => {});
    }

    // 12. Create / Link Movie Rights Record
    await prisma.movieRight.create({
      data: {
        movieId: movie.id,
        sourceChannelId: channelId,
        licenseType: source.licenseType || 'authorized_redistribution',
        verificationStatus: source.rightsStatus,
        notes: `Imported via Telegram post #${messageId} from channel ${source.channelTitle}`,
      },
    }).catch(() => {});

    // 13. Determine Final Status
    const canAutoPublish = source.autoPublish && isRightsVerified;
    const finalStatus = canAutoPublish ? 'published' : 'requires_review';

    await prisma.telegramImport.update({
      where: { id: importJob.id },
      data: {
        status: finalStatus,
        parsedTitle: movieTitle,
        parsedYear: releaseDate,
        parsedQuality: detectedQuality,
        codec: detectedCodec,
        audioLang: parsedMeta.audioLanguage,
        resolutionVerified: verifiedResolution,
        movieId: movie.id,
        errorMessage: null,
      },
    });

    console.log(`[TELEGRAM_IMPORT] SUCCESS: Import #${importJob.id} finished with status "${finalStatus}" for "${movieTitle}" [${detectedQuality}].`);

    return {
      success: true,
      status: finalStatus,
      movieId: movie.id,
      variantId: variant.id,
      quality: detectedQuality,
      movieTitle,
    };
  } catch (err) {
    console.error(`[TELEGRAM_IMPORT] ERROR during import of msg #${messageId}:`, err);

    await prisma.telegramImport.update({
      where: { id: importJob.id },
      data: {
        status: 'failed',
        errorMessage: String(err.message || err).slice(0, 1000),
        retryCount: { increment: 1 },
      },
    }).catch(() => {});

    return {
      success: false,
      status: 'failed',
      reason: err.message,
    };
  }
}

/**
 * Trigger manual import of a specific file or message
 */
export async function manualImport({ channelId, messageId, fileId, fileName, caption } = {}) {
  let messageObject = null;

  // 1. If messageId and channelId are given, try to resolve from Telegram API
  if (channelId && messageId) {
    try {
      // In Bot API, we can fetch message via copyMessage or forwardMessage,
      // or construct a synthetic message if fileId is supplied
      messageObject = {
        chat: { id: channelId },
        message_id: parseInt(messageId, 10),
        caption: caption || '',
        document: fileId ? { file_id: fileId, file_name: fileName } : null,
      };
    } catch {}
  }

  // 2. Direct fileId provided
  if (!messageObject && fileId) {
    messageObject = {
      chat: { id: channelId || config.telegram.chatId || '-1000000000' },
      message_id: Math.floor(Date.now() / 1000),
      caption: caption || '',
      document: {
        file_id: fileId,
        file_name: fileName || 'movie.mp4',
      },
    };
  }

  if (!messageObject) {
    throw new Error('Please provide at least a file_id or a valid channelId and messageId');
  }

  return processIncomingTelegramPost(messageObject);
}

/**
 * Retry a failed import job
 */
export async function retryImport(importId) {
  const importJob = await prisma.telegramImport.findUnique({
    where: { id: importId },
  });

  if (!importJob) {
    throw new Error(`Import job "${importId}" not found`);
  }

  const syntheticMessage = {
    chat: { id: importJob.sourceChannelId },
    message_id: importJob.messageId,
    caption: importJob.caption || '',
    document: {
      file_id: importJob.fileId,
      file_unique_id: importJob.fileUniqueId,
      file_name: importJob.fileName,
      file_size: importJob.fileSizeBytes,
      mime_type: importJob.mimeType,
    },
  };

  return processIncomingTelegramPost(syntheticMessage, importJob.updateId);
}

/**
 * Remove a specific quality variant
 */
export async function removeMovieVariant(variantId) {
  const variant = await prisma.movieFileVariant.findUnique({
    where: { id: variantId },
    include: { movie: true },
  });

  if (!variant) {
    throw new Error(`Variant "${variantId}" not found`);
  }

  const movieId = variant.movieId;

  // Delete variant
  await prisma.movieFileVariant.delete({
    where: { id: variantId },
  });

  // Re-sync Movie.telegram_files
  const remainingVariants = await prisma.movieFileVariant.findMany({
    where: { movieId, isAvailable: true },
  });

  const tgFilesArray = remainingVariants.map((v) => ({
    file_id: v.telegramFileId,
    quality: v.quality,
    size: v.fileSizeFormatted || formatBytes(v.fileSizeBytes) || 'Unknown',
    fileName: v.fileName,
  }));

  await prisma.movie.update({
    where: { id: movieId },
    data: {
      telegram_files: tgFilesArray.length > 0 ? JSON.stringify(tgFilesArray) : null,
    },
  });

  return { success: true, remainingCount: remainingVariants.length };
}

/**
 * Automatically seeds the primary configured TELEGRAM_CHAT_ID as an authorized source
 */
export async function seedDefaultTelegramSource() {
  const primaryChatId = config.telegram.chatId ? String(config.telegram.chatId).trim() : '';
  if (!primaryChatId) return null;

  const normalizedChatId = primaryChatId.replace(/^-100/, '');
  try {
    const existing = await prisma.telegramSource.findFirst({
      where: {
        OR: [
          { channelId: primaryChatId },
          { channelId: `-100${normalizedChatId}` },
          { channelId: normalizedChatId }
        ]
      }
    });

    if (!existing) {
      const created = await prisma.telegramSource.create({
        data: {
          channelId: primaryChatId,
          channelTitle: 'Primary Authorized Channel',
          isAuthorized: true,
          autoImport: true,
          autoPublish: true,
          rightsStatus: 'verified',
          licenseType: 'authorized_primary_cdn',
          licenseNotes: 'Pre-configured authorized Telegram CDN source from environment'
        }
      });
      console.log(`[TELEGRAM_SOURCE] Auto-seeded primary authorized Telegram channel: ${primaryChatId}`);
      return created;
    }
    return existing;
  } catch (err) {
    console.warn('[TELEGRAM_SOURCE] Failed seeding default Telegram source:', err.message);
    return null;
  }
}

export default {
  verifyChannelAccess,
  registerWebhook,
  getWebhookInfo,
  processIncomingTelegramPost,
  manualImport,
  retryImport,
  removeMovieVariant,
  seedDefaultTelegramSource,
  WEBHOOK_SECRET_TOKEN,
};
