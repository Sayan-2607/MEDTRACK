/**
 * Portable backup archive + authenticated encryption (spec §18).
 * Crypto uses only standard WebCrypto primitives: PBKDF2-SHA256 (310k iterations) → AES-256-GCM.
 * No custom scheme. Recovery strategy: the passphrase IS the recovery key — it is never stored or uploaded;
 * a lost passphrase means the encrypted backup cannot be opened (documented in docs/BACKUP.md).
 */
import { db, SCHEMA_VERSION, uid } from '../db/schema';

export const APP_VERSION = '1.0.0';
const MAGIC = 'MEDTRACK-ENC-1';
const EXCLUDE = new Set(['pendingSnapshots']);

export interface Manifest { app: 'MEDTRACK'; appVersion: string; schemaVersion: number; datasetVersion: string | null; createdAt: number; counts: Record<string, number>; checksum: string; lastLocalChange: number; }

async function sha256(buf: ArrayBuffer | Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf as BufferSource);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function lastLocalChange(): Promise<number> {
  const [a, p] = await Promise.all([db.audit.orderBy('at').last(), db.progress.orderBy('videoId').toArray()]);
  return Math.max(a?.at ?? 0, ...p.map(x => x.lastUpdatedAt), 0);
}

export async function exportPlain(): Promise<{ manifest: Manifest; payload: Uint8Array }> {
  const tables: Record<string, unknown[]> = {}; const counts: Record<string, number> = {};
  for (const t of db.tables) { if (EXCLUDE.has(t.name)) continue; tables[t.name] = await t.toArray(); counts[t.name] = tables[t.name].length; }
  const data = new TextEncoder().encode(JSON.stringify(tables));
  const batch = await db.importBatches.orderBy('importedAt').last();
  const manifest: Manifest = { app: 'MEDTRACK', appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION, datasetVersion: batch?.datasetVersion ?? null,
    createdAt: Date.now(), counts, checksum: await sha256(data), lastLocalChange: await lastLocalChange() };
  return { manifest, payload: data };
}

async function deriveKey(pass: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** File format: JSON { magic, manifest (plaintext, so a backup can be listed/previewed), salt, iv, ciphertext(b64) }.
 *  The manifest is bound to the ciphertext as AES-GCM additional authenticated data — tampering fails decryption. */
export async function buildArchive(passphrase: string | null): Promise<{ blob: Blob; manifest: Manifest }> {
  const { manifest, payload } = await exportPlain();
  if (!passphrase) return { blob: new Blob([JSON.stringify({ magic: 'MEDTRACK-PLAIN-1', manifest, data: JSON.parse(new TextDecoder().decode(payload)) })], { type: 'application/json' }), manifest };
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const aad = new TextEncoder().encode(JSON.stringify(manifest));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, payload as BufferSource));
  let bin = ''; for (let i = 0; i < ct.length; i += 0x8000) bin += String.fromCharCode(...ct.subarray(i, i + 0x8000));
  return { blob: new Blob([JSON.stringify({ magic: MAGIC, manifest, salt: b64(salt), iv: b64(iv), ct: btoa(bin) })], { type: 'application/json' }), manifest };
}

export interface OpenedArchive { manifest: Manifest; tables: Record<string, any[]>; }
export async function openArchive(text: string, passphrase: string | null): Promise<OpenedArchive> {
  let j: any; try { j = JSON.parse(text); } catch { throw new Error('Archive is corrupted (not valid JSON).'); }
  if (j.magic === 'MEDTRACK-PLAIN-1') {
    const bytes = new TextEncoder().encode(JSON.stringify(j.data));
    if ((await sha256(bytes)) !== j.manifest.checksum) throw new Error('Checksum mismatch — archive is corrupted or was modified.');
    return check({ manifest: j.manifest, tables: j.data });
  }
  if (j.magic !== MAGIC) throw new Error('Not a MEDTRACK backup file.');
  if (!passphrase) throw new Error('This backup is encrypted. Enter its passphrase.');
  const key = await deriveKey(passphrase, unb64(j.salt));
  let pt: ArrayBuffer;
  try { pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(j.iv) as BufferSource, additionalData: new TextEncoder().encode(JSON.stringify(j.manifest)) }, key, unb64(j.ct) as BufferSource); }
  catch { throw new Error('Decryption failed — wrong passphrase or the archive was altered.'); }
  if ((await sha256(pt)) !== j.manifest.checksum) throw new Error('Checksum mismatch — archive is corrupted.');
  return check({ manifest: j.manifest, tables: JSON.parse(new TextDecoder().decode(pt)) });
}
function check(a: OpenedArchive) {
  if (a.manifest.schemaVersion > SCHEMA_VERSION) throw new Error(`Backup schema v${a.manifest.schemaVersion} is newer than this app (v${SCHEMA_VERSION}). Update the app first.`);
  return a;
}

/** Replace: snapshot current data locally first (safety copy), then replace all tables in one transaction. */
export async function restoreReplace(a: OpenedArchive) {
  const safety = await buildArchive(null);
  await db.pendingSnapshots.put({ id: 'pre-restore-' + Date.now(), createdAt: Date.now(), blob: safety.blob, checksum: safety.manifest.checksum, manifest: safety.manifest });
  await db.transaction('rw', db.tables.filter(t => !EXCLUDE.has(t.name)), async () => {
    for (const t of db.tables) { if (EXCLUDE.has(t.name)) continue; await t.clear(); if (a.tables[t.name]) await t.bulkPut(a.tables[t.name]); }
  });
}
/** Safe merge: catalogue/plans/sessions are added if absent; video progress keeps whichever record is newer. */
export async function restoreMerge(a: OpenedArchive) {
  await db.transaction('rw', db.tables.filter(t => !EXCLUDE.has(t.name)), async () => {
    for (const t of db.tables) {
      if (EXCLUDE.has(t.name) || !a.tables[t.name]) continue;
      const pk = t.schema.primKey.keyPath as string;
      for (const row of a.tables[t.name]) {
        const cur = await t.get(row[pk]);
        if (!cur) await t.put(row);
        else if (t.name === 'progress' && row.lastUpdatedAt > cur.lastUpdatedAt) await t.put(row);
      }
    }
  });
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export async function recordLocalBackup(manifest: Manifest, size: number) {
  await db.backups.add({ id: uid('bk_'), provider: 'local', backupTimestamp: manifest.createdAt, remoteFileId: null, checksum: manifest.checksum, schemaVersion: manifest.schemaVersion, status: 'success', error: null, manifest, sizeBytes: size });
}
