import express from 'express';
import {
  processIncomingTelegramPost,
  registerWebhook,
  getWebhookInfo,
  manualImport,
  verifyChannelAccess,
  WEBHOOK_SECRET_TOKEN,
} from '../services/telegramImportService.js';
import prisma from '../prisma/client.js';

const router = express.Router();

/**
 * POST /api/telegram/webhook
 * Receives real-time channel posts and messages from Telegram Bot API.
 * Authenticated via X-Telegram-Bot-Api-Secret-Token header.
 */
router.post('/webhook', async (req, res) => {
  const secretHeader = req.headers['x-telegram-bot-api-secret-token'];

  // 1. Webhook Secret Token Verification
  if (!secretHeader || secretHeader !== WEBHOOK_SECRET_TOKEN) {
    console.warn(`[TELEGRAM_WEBHOOK] Unauthorized request rejected from ${req.ip} - invalid secret token.`);
    return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid secret token' });
  }

  const update = req.body;
  if (!update || typeof update !== 'object') {
    return res.status(400).json({ ok: false, error: 'Invalid update body' });
  }

  // Acknowledge receipt to Telegram promptly
  res.status(200).json({ ok: true });

  // 2. Process channel_post or message asynchronously
  try {
    const post = update.channel_post || update.message;
    if (post) {
      console.log(`[TELEGRAM_WEBHOOK] Received update ID ${update.update_id} for channel ${post.chat?.id}`);
      await processIncomingTelegramPost(post, update.update_id);
    }
  } catch (err) {
    console.error('[TELEGRAM_WEBHOOK] Error handling update:', err.message);
  }
});

/**
 * POST /api/telegram/setup-webhook
 * Registers the webhook with Telegram Bot API
 * Body: { webhookUrl: "https://yourdomain.com/api/telegram/webhook" }
 */
router.post('/setup-webhook', async (req, res) => {
  try {
    let { webhookUrl } = req.body;
    if (!webhookUrl) {
      const host = req.headers.host;
      const proto = req.headers['x-forwarded-proto'] || 'https';
      webhookUrl = `${proto}://${host}/api/telegram/webhook`;
    }

    const result = await registerWebhook(webhookUrl);
    res.json({
      success: result.success,
      webhookUrl,
      description: result.description,
      secretConfigured: Boolean(WEBHOOK_SECRET_TOKEN),
    });
  } catch (err) {
    console.error('[TELEGRAM_WEBHOOK] Failed setting webhook:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/telegram/webhook-info
 * Returns current webhook status from Telegram Bot API
 */
router.get('/webhook-info', async (req, res) => {
  try {
    const info = await getWebhookInfo();
    res.json({
      success: true,
      data: info,
      secretConfigured: Boolean(WEBHOOK_SECRET_TOKEN),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/telegram/manual-import
 * Triggers manual movie import from a Telegram file_id or channel post
 */
router.post('/manual-import', async (req, res) => {
  try {
    const { channelId, messageId, fileId, fileName, caption } = req.body;
    if (!fileId && (!channelId || !messageId)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide either a file_id or both channelId and messageId',
      });
    }

    const result = await manualImport({ channelId, messageId, fileId, fileName, caption });
    res.json({
      success: result.success,
      result,
    });
  } catch (err) {
    console.error('[TELEGRAM_IMPORT] Manual import failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/telegram/verify-channel
 * Verifies channel ID and bot permissions
 */
router.post('/verify-channel', async (req, res) => {
  try {
    const { channelId } = req.body;
    if (!channelId) {
      return res.status(400).json({ success: false, message: 'channelId is required' });
    }

    const check = await verifyChannelAccess(channelId);
    res.json({
      success: check.ok,
      data: check,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
