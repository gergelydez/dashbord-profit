/**
 * lib/google/drive.ts
 * Folder-per-month-per-category storage on the connected Google account's
 * Drive: "GLAMX Documente / {Year} / {MM - MonthName} / {Category} / {Subcategory?}".
 * Every folder lookup is find-or-create (idempotent) — safe to call repeatedly
 * across separate serverless invocations without ever creating duplicates.
 */
import { Readable } from 'stream';
import type { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { db } from '@/lib/db';

const ROOT_FOLDER_NAME = 'GLAMX Documente';
const ROOT_SETTING_KEY = 'drive:rootFolderId';

const MONTH_NAMES_RO = [
  'Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie',
  'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie',
];

function escapeForQuery(name: string): string {
  return name.replace(/'/g, "\\'");
}

async function findFolder(auth: OAuth2Client, name: string, parentId?: string): Promise<string | null> {
  const drive = google.drive({ version: 'v3', auth });
  const parentClause = parentId ? ` and '${parentId}' in parents` : " and 'root' in parents";
  const q = `mimeType='application/vnd.google-apps.folder' and name='${escapeForQuery(name)}' and trashed=false${parentClause}`;
  const res = await drive.files.list({ q, fields: 'files(id,name)', spaces: 'drive', pageSize: 1 });
  return res.data.files?.[0]?.id || null;
}

async function createFolder(auth: OAuth2Client, name: string, parentId?: string): Promise<string> {
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    },
    fields: 'id',
  });
  if (!res.data.id) throw new Error(`Drive nu a întors un id la crearea folderului "${name}"`);
  return res.data.id;
}

export async function ensureFolder(auth: OAuth2Client, name: string, parentId?: string): Promise<string> {
  const existing = await findFolder(auth, name, parentId);
  if (existing) return existing;
  return createFolder(auth, name, parentId);
}

// Per-invocation cache only (process-lifetime) — always safe to lose on a cold
// start since ensureFolder() is idempotent; this just avoids redundant Drive
// API calls when uploading many files from the same month/category in one sync.
const pathCache = new Map<string, string>();

async function ensureFolderCached(auth: OAuth2Client, name: string, parentId: string | undefined, cacheKey: string): Promise<string> {
  const cached = pathCache.get(cacheKey);
  if (cached) return cached;
  const id = await ensureFolder(auth, name, parentId);
  pathCache.set(cacheKey, id);
  return id;
}

async function getRootFolderId(auth: OAuth2Client): Promise<string> {
  const setting = await db.appSetting.findUnique({ where: { key: ROOT_SETTING_KEY } });
  if (typeof setting?.value === 'string' && setting.value) return setting.value;

  const id = await ensureFolder(auth, ROOT_FOLDER_NAME);
  await db.appSetting.upsert({
    where: { key: ROOT_SETTING_KEY },
    create: { key: ROOT_SETTING_KEY, value: id },
    update: { value: id },
  });
  return id;
}

/**
 * Romanian ș/ț (comma-below, U+0219/U+021B — the correct modern spelling)
 * vs ş/ţ (cedilla, U+015F/U+0163 — a legacy encoding many phone keyboards
 * still produce) look identical on screen but are different codepoints.
 * Confirmed live: a category typed by hand ("Recepție") used a different
 * variant than this codebase's own hardcoded string, and Drive's
 * exact-name folder lookup silently created a second, visually-identical
 * "Recepție" folder instead of finding the existing one. Canonicalizing
 * here — the one place every folder path passes through — means it no
 * longer matters which variant any given caller happens to use.
 */
function normalizeRoDiacritics(s: string): string {
  return s.replace(/ş/g, 'ș').replace(/Ş/g, 'Ș').replace(/ţ/g, 'ț').replace(/Ţ/g, 'Ț');
}

/** month = "2026-08". Returns the final folder id, creating any missing folder along the path. */
export async function getOrCreateMonthPath(
  auth: OAuth2Client,
  month: string,
  category: string,
  subcategory?: string | null,
): Promise<string> {
  const [yearStr, monthStr] = month.split('-');
  const monthNum = parseInt(monthStr, 10);
  const monthLabel = `${monthStr} - ${MONTH_NAMES_RO[monthNum - 1] || monthStr}`;
  const cat = normalizeRoDiacritics(category);
  const subcat = subcategory ? normalizeRoDiacritics(subcategory) : subcategory;

  const rootId = await getRootFolderId(auth);
  const yearId = await ensureFolderCached(auth, yearStr, rootId, `${rootId}/${yearStr}`);
  const monthId = await ensureFolderCached(auth, monthLabel, yearId, `${yearId}/${monthLabel}`);
  const catId = await ensureFolderCached(auth, cat, monthId, `${monthId}/${cat}`);
  if (!subcat) return catId;
  return ensureFolderCached(auth, subcat, catId, `${catId}/${subcat}`);
}

export async function uploadFile(
  auth: OAuth2Client,
  name: string,
  parentId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<{ fileId: string; webViewLink: string | null }> {
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.create({
    requestBody: { name, parents: [parentId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, webViewLink',
  });
  if (!res.data.id) throw new Error(`Drive nu a întors un id la urcarea fișierului "${name}"`);
  return { fileId: res.data.id, webViewLink: res.data.webViewLink || null };
}

/**
 * Confirmed bug: `{ responseType: 'arraybuffer' }` here was silently
 * corrupting binary files (xlsx confirmed — correct and complete when
 * viewed directly on Drive, but garbled after this round-trip: diacritics
 * mangled, most columns lost). gaxios/googleapis' arraybuffer handling for
 * Drive's alt=media downloads isn't reliable for binary content; 'stream'
 * is the pattern Google's own docs use and reads raw bytes with nothing
 * in between that could reinterpret them as text.
 */
export async function downloadFile(auth: OAuth2Client, fileId: string): Promise<Buffer> {
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    res.data
      .on('data', (chunk: Buffer) => chunks.push(chunk))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject);
  });
}

/** Moves a file to trash (reversible from Drive's own Trash) — used when a sender gets ignored after already being ingested. */
export async function trashFile(auth: OAuth2Client, fileId: string): Promise<void> {
  const drive = google.drive({ version: 'v3', auth });
  await drive.files.update({ fileId, requestBody: { trashed: true } });
}

/** Moves a file to a new parent folder (e.g. reclassifying a "Neclasificate" document) — removes it from all current parents first. */
export async function moveFile(auth: OAuth2Client, fileId: string, newParentId: string): Promise<void> {
  const drive = google.drive({ version: 'v3', auth });
  const meta = await drive.files.get({ fileId, fields: 'parents' });
  const removeParents = (meta.data.parents || []).join(',');
  await drive.files.update({
    fileId,
    addParents: newParentId,
    removeParents: removeParents || undefined,
    fields: 'id, parents',
  });
}
