# Zinemo — Automated Telegram Movie Import & Multi-Quality Download System

A production-ready, fully automated movie import, rights verification, and direct-download streaming engine integrated directly into Zinemo.

---

## 1. System Architecture Overview

```
Authorized Telegram Channel
         │  (Movie file posted: 480p, 720p, 1080p, or 4K)
         ▼
Telegram Webhook (`POST /api/telegram/webhook`)
         │  (X-Telegram-Bot-Api-Secret-Token verification)
         ▼
Source Authorization & Rights Validation
         ├── Reject if Channel is not authorized (401/403)
         └── Reject if Redistribution Rights are revoked/expired
         ▼
Metadata Extraction & Normalization (`movieDetector.js`)
         ├── Extract Title, Release Year, Quality, Codec, Audio Language, Subtitles
         └── FFprobe resolution verification (when Local Bot API disk path is accessible)
         ▼
TMDB Search & Deterministic Matching
         ├── Search TMDB for canonical poster, backdrop, synopsis, ratings
         └── Match against existing Movie record by TMDB ID / Normalized Title
         ▼
Multi-Quality Variant Attachment (`MovieFileVariant`)
         ├── Upsert variant for exact resolution (480p, 720p, 1080p, 4K)
         ├── If 1080p arrives for an existing 720p movie, automatically updates existing page
         └── Update `Movie.telegram_files` JSON array for instant frontend reactivity
         ▼
Auto-Publish Engine
         ├── If source channel has `autoPublish: true` & `rightsStatus: 'verified'` -> PUBLISHED
         └── Otherwise -> REQUIRES REVIEW (held for admin manual approval)
         ▼
Direct Website Downloads (`/api/download/direct?token=...`)
         ├── Cryptographic HMAC-SHA256 signed tokens with expiration
         ├── HTTP Range requests (206 Partial Content, seeking & resume support)
         ├── Concurrency limits & rate limiting per client IP
         ├── Nginx X-Accel-Redirect offloading (zero Node RAM overhead)
         └── Direct browser download — NO redirect to Telegram
```

---

## 2. Configuration & Environment Variables

Add the following to your root `.env` or `backend/.env`:

```env
# ----------------------------------------------------------------------
# Telegram Bot & Local Bot API
# ----------------------------------------------------------------------
TELEGRAM_BOT_TOKEN="your_bot_token_from_botfather"
TELEGRAM_CHAT_ID="-1001234567890"
TELEGRAM_LOCAL_API_URL="http://telegram-api:8081"
TELEGRAM_API_DATA_DIR="/var/lib/telegram-bot-api"
TELEGRAM_API_ID="23271365"
TELEGRAM_API_HASH="59a8393f1c17083798b42333d16ff224"

# ----------------------------------------------------------------------
# Automated Import Webhook & Security
# ----------------------------------------------------------------------
# Webhook secret token for authenticating channel_post updates from Telegram
TELEGRAM_WEBHOOK_SECRET="your_strong_webhook_secret_here"

# Cryptographic HMAC signing secret for direct download URLs
DOWNLOAD_SIGNING_SECRET="your_download_signing_secret_here"

# Maximum simultaneous streaming downloads per client IP (prevents bandwidth abuse)
MAX_CONCURRENT_DOWNLOADS=4

# Low-RAM stability tuning
TELEGRAM_CHUNK_GB=0.5
TELEGRAM_HWM_MB=4
TELEGRAM_SHARED_DIR="/app/shared"

# Set to true if running behind Nginx with internal protected downloads
USE_X_ACCEL_REDIRECT=false
```

---

## 3. Step-by-Step Setup

### Step 1: Telegram Bot Registration
1. Open Telegram and message `@BotFather`.
2. Send `/newbot`, name your bot (e.g., `ZinemoEngineBot`), and choose a username.
3. Save the HTTP API Token to `TELEGRAM_BOT_TOKEN`.
4. Send `/setprivacy` -> Select your bot -> Choose `Disable` so the bot can read movie posts in channels it administers.

### Step 2: Add and Authorize Channels
1. Add your bot as an **Administrator** in your authorized Telegram movie channel (giving it read messages permission).
2. Open the Zinemo Admin Dashboard at `/admin` (or click "Telegram Automation" in the website footer).
3. Click **"Authorize Channel"**:
   - **Channel ID**: e.g., `-1001234567890` (or `@channelname`)
   - **Channel Title**: (optional, auto-detected from Telegram)
   - **Auto-Import**: Enable to automatically ingest new posts
   - **Auto-Publish**: Enable to publish automatically once rights are verified
   - **Rights Status**: Set to `Verified` (or `Pending Verification`)
   - **License Notes**: Reference to your distribution authorization agreement
4. Click **"Verify Bot"** to confirm bot permissions via Telegram API.

### Step 3: Register Telegram Webhook
1. In the Admin Dashboard (`/admin`), switch to the **"Webhook Configuration"** tab.
2. Enter your public HTTPS domain webhook URL:
   ```
   https://zinemo.com/api/telegram/webhook
   ```
3. Click **"Register with Telegram Bot API"**.
4. The system will register the webhook with your `TELEGRAM_WEBHOOK_SECRET` token for automated payload verification.

---

## 4. Automatic Movie Detection & Multi-Quality Pipeline

When an authorized channel posts a movie file (e.g., `Movie.Title.2026.720p.WEB-DL.mkv`):

1. **Resolution & Metadata Detection**:
   - Extracts clean movie title: `Movie Title`
   - Extracts release year: `2026`
   - Detects video quality: `720p`, `1080p`, `4K`, or `480p`
   - Detects codecs (`H.264`, `HEVC`, `AV1`), audio (`Dual Audio`, `Tamil`, `English`), subtitles (`ESub`)
   - Verifies pixel dimensions using FFprobe when local disk files are available.

2. **Deduplication & Multi-Quality Upgrades**:
   - If `Movie Title (2026)` already exists in the database with a `720p` variant, an incoming `1080p` post **does not** create a duplicate movie page.
   - It attaches the `1080p` variant directly to the existing movie record and updates the frontend download options immediately.

3. **Status Flow**:
   - `Pending`: Ingesting file metadata.
   - `Processing`: Checking FFprobe resolution and TMDB details.
   - `Published`: Approved and live on website with working download buttons.
   - `Requires Review`: Source requires administrative review or metadata was ambiguous.
   - `Failed`: Errored during processing (retryable with 1-click in the dashboard).
   - `Rights Expired`: Channel license expired; download links are blocked immediately.

---

## 5. Direct Website Downloads

Visitors download directly through the Zinemo website:

- **Signed Download Links**: `GET /api/download/token/:variantId` generates a cryptographically signed HMAC URL with an expiration window.
- **HTTP Range Requests**: Full HTTP `206 Partial Content` support (`bytes=start-end`), enabling seeking in media players and seamless download pause/resume.
- **RFC 5987 Content-Disposition**: Sets clean download filenames (e.g., `Movie Title (2026) [1080p].mp4`) with correct MIME types.
- **Zero-Redirect**: Download bytes stream directly from the storage server to the visitor's browser.
- **Rights Enforcement**: If a title's distribution rights are marked revoked or expired, the download endpoint immediately returns `403 Forbidden`.

---

## 6. Admin Dashboard Features (`/admin`)

- **Authorized Channels**: List connected channels, toggle auto-import and auto-publish, view post counts, verify bot permissions, or revoke source access.
- **Import Queue & History**: Real-time status badges, detected resolutions (with FFprobe verification indicators), 1-click retry for failed jobs, and manual approval for pending reviews.
- **Manual Import Tool**: Direct import of any Telegram `file_id` or channel message ID with automatic metadata resolution.
- **Webhook Inspector**: Inspect webhook status, pending Telegram updates, SSL status, and last errors.
- **Analytics Overview**: Ingested qualities distribution (4K, 1080p, 720p, 480p), total downloads logged, and active channels.

---

## 7. VPS & Docker Deployment

Deploying with Docker Compose:

```bash
# 1. Update environment variables
cp .env.example .env

# 2. Synchronize database schema safely (preserves existing SQLite data)
cd backend
npx prisma db push
npx prisma generate
cd ..

# 3. Start or update containers
docker-compose up -d --build
```

All existing Docker volumes (`zenemozite-data`, `telegram-shared`, `./tg-api-data`) are preserved.
