// ==============================================================================
// Hybrid Storage Cache — Google Drive route (files > 2GB)
// Multi-account support: every DriveAccount row in Prisma carries its own
// service-account credentials; each gets its own authenticated client.
// ==============================================================================
import fs from 'fs';
import googleapisPkg from 'googleapis';
import { config } from './config.js';

const { google } = googleapisPkg;
const SCOPES = ['https://www.googleapis.com/auth/drive'];

// account.id -> { jwt, creds } (clients are reused across requests)
const authClients = new Map();

/** Build (or reuse) the authenticated client for a DriveAccount row */
function getAuth(account) {
  if (!authClients.has(account.id)) {
    let creds;
    const raw = String(account.credentials || '').trim();
    if (raw.startsWith('{')) {
      creds = JSON.parse(raw); // credentials column holds the key JSON itself
    } else {
      creds = JSON.parse(fs.readFileSync(raw, 'utf8')); // credentials column holds a path to the key file
    }
    if (typeof creds.private_key === 'string') {
      creds.private_key = creds.private_key.replace(/\\n/g, '\n');
    }
    const jwt = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: SCOPES,
    });
    authClients.set(account.id, { jwt, creds });
  }
  return authClients.get(account.id);
}

function getDriveClient(account) {
  const { jwt } = getAuth(account);
  return google.drive({ version: 'v3', auth: jwt });
}

/**
 * Stable direct-download link for a public Drive file.
 * `confirm=t` bypasses the "can't scan for viruses" interstitial on big files.
 */
export function buildDirectLink(fileId) {
  return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
}

/**
 * Stream a file from disk into the account's Drive (optionally into a shared folder).
 * The file is made publicly readable so the direct link works for end users.
 * @returns {{ fileId: string }}
 */
export async function uploadFile(account, filePath, uploadName, mimeType) {
  const drive = getDriveClient(account);

  const res = await drive.files.create({
    requestBody: {
      name: uploadName,
      ...(config.gdrive.folderId ? { parents: [config.gdrive.folderId] } : {}),
    },
    media: {
      mimeType: mimeType || 'application/octet-stream',
      body: fs.createReadStream(filePath),
    },
    fields: 'id,name,size',
  });

  const fileId = res.data.id;
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { type: 'anyone', role: 'reader' },
    });
  } catch (err) {
    console.error(`[HYBRID_GDRIVE] Could not make ${fileId} public:`, err.message);
  }

  console.log(`[HYBRID_GDRIVE] Uploaded "${uploadName}" to ${account.email} -> ${fileId}`);
  return { fileId };
}

/**
 * Delete a file from the account (LRU eviction). A 404 is treated as success
 * (the file was already gone) so the eviction bookkeeping still proceeds.
 */
export async function deleteFile(account, fileId) {
  const drive = getDriveClient(account);
  try {
    await drive.files.delete({ fileId });
    console.log(`[HYBRID_GDRIVE] LRU deleted ${fileId} from ${account.email}`);
  } catch (err) {
    const status = err?.response?.status || err?.status || err?.code;
    if (status === 404 || /not found/i.test(err.message || '')) {
      console.warn(`[HYBRID_GDRIVE] ${fileId} was already deleted (404) — treating as freed`);
      return;
    }
    throw err;
  }
}

/**
 * Live quota snapshot straight from the Google API (used by /accounts/sync to
 * correct drift between the Prisma usedSpace column and reality).
 */
export async function getLiveQuota(account) {
  const drive = getDriveClient(account);
  const res = await drive.about.get({ fields: 'storageQuota,user' });
  const q = res.data.storageQuota || {};
  return {
    email: res.data.user?.emailAddress || account.email,
    totalSpace: Number(q.limit) || config.gdrive.defaultAccountBytes,
    usedSpace: Number(q.usage) || 0,
  };
}

export default { buildDirectLink, uploadFile, deleteFile, getLiveQuota };