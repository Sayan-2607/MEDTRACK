/**
 * Google Drive backup (optional). Scope: drive.appdata only (hidden app-specific folder).
 * OAuth: Google Identity Services token client. The access token is kept in memory only — never persisted,
 * so there is no plaintext token at rest. Expired/revoked tokens trigger a fresh consent prompt.
 * Network destinations: accounts.google.com (sign-in), www.googleapis.com (Drive API). Nothing else.
 */
import { db, uid } from '../db/schema';
import { buildArchive, type Manifest } from './archive';
import { loadSettings } from '../data/settings';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
let token: { value: string; exp: number } | null = null;
let gisLoading: Promise<void> | null = null;
let running = false;

export const driveConfigured = () => !!CLIENT_ID;
export const driveConnected = () => !!token && token.exp > Date.now();

function loadGis() {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve();
  return (gisLoading ??= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => { gisLoading = null; rej(new Error('Could not load Google sign-in (offline?)')); };
    document.head.appendChild(s);
  }));
}
export async function connect(prompt: '' | 'consent' = ''): Promise<void> {
  if (!CLIENT_ID) throw new Error('Google Drive backup is not configured for this deployment (VITE_GOOGLE_CLIENT_ID missing). See docs/BACKUP.md.');
  await loadGis();
  await new Promise<void>((res, rej) => {
    const c = (window as any).google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE,
      callback: (r: any) => { if (r.error) return rej(new Error(r.error_description || r.error)); token = { value: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 }; localStorage.setItem('mt_drive_linked', '1'); res(); },
      error_callback: (e: any) => rej(new Error(e?.message || 'Sign-in cancelled')) });
    c.requestAccessToken({ prompt });
  });
}
export function disconnect() {
  if (token && (window as any).google?.accounts?.oauth2) (window as any).google.accounts.oauth2.revoke(token.value, () => {});
  token = null; try { localStorage.removeItem('mt_drive_linked'); } catch { /* ignore */ }
}
export const wasLinked = () => { try { return localStorage.getItem('mt_drive_linked') === '1'; } catch { return false; } };

async function api(path: string, init: RequestInit = {}, base = 'https://www.googleapis.com') {
  if (!driveConnected()) await connect();
  const r = await fetch(base + path, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + token!.value } });
  if (r.status === 401) { token = null; throw new Error('Google authorisation expired or was revoked. Reconnect Google Drive.'); }
  if (!r.ok) throw new Error(`Drive error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}

export interface RemoteBackup { id: string; name: string; createdTime: string; size: string; appProperties?: Record<string, string>; }
export async function listRemote(): Promise<RemoteBackup[]> {
  const r = await api('/drive/v3/files?spaces=appDataFolder&orderBy=createdTime desc&pageSize=100&fields=files(id,name,createdTime,size,appProperties)');
  return (await r.json()).files ?? [];
}
export async function downloadRemote(id: string): Promise<string> { return (await api(`/drive/v3/files/${id}?alt=media`)).text(); }

async function upload(blob: Blob, manifest: Manifest): Promise<string> {
  const meta = { name: `medtrack-${new Date(manifest.createdAt).toISOString().replace(/[:.]/g, '-')}.mtbk`, parents: ['appDataFolder'],
    appProperties: { checksum: manifest.checksum, schema: String(manifest.schemaVersion), app: manifest.appVersion } };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', blob);
  const r = await api('/upload/drive/v3/files?uploadType=multipart&fields=id,size', { method: 'POST', body: form });
  const j = await r.json();
  if (!j.id) throw new Error('Drive did not confirm the upload.');
  return j.id;
}

/** Backup now. Offline → store a pending snapshot locally; it is uploaded by flushPending() when back online.
 *  Success is only recorded after Drive returns a file id. */
export async function backupNow(passphrase: string): Promise<{ status: 'success' | 'queued'; id?: string }> {
  if (running) throw new Error('A backup is already running.');
  running = true;
  try {
    const { blob, manifest } = await buildArchive(passphrase);
    if (!navigator.onLine) {
      await db.pendingSnapshots.put({ id: uid('snap_'), createdAt: Date.now(), blob, checksum: manifest.checksum, manifest });
      await db.backups.add({ id: uid('bk_'), provider: 'drive', backupTimestamp: manifest.createdAt, remoteFileId: null, checksum: manifest.checksum, schemaVersion: manifest.schemaVersion, status: 'pending', error: 'Offline — queued', manifest, sizeBytes: blob.size });
      return { status: 'queued' };
    }
    try {
      const fid = await upload(blob, manifest);
      await db.backups.add({ id: uid('bk_'), provider: 'drive', backupTimestamp: manifest.createdAt, remoteFileId: fid, checksum: manifest.checksum, schemaVersion: manifest.schemaVersion, status: 'success', error: null, manifest, sizeBytes: blob.size });
      await applyRetention();
      return { status: 'success', id: fid };
    } catch (e: any) {
      await db.pendingSnapshots.put({ id: uid('snap_'), createdAt: Date.now(), blob, checksum: manifest.checksum, manifest });
      await db.backups.add({ id: uid('bk_'), provider: 'drive', backupTimestamp: manifest.createdAt, remoteFileId: null, checksum: manifest.checksum, schemaVersion: manifest.schemaVersion, status: 'failed', error: e.message, manifest, sizeBytes: blob.size });
      throw e;
    }
  } finally { running = false; }
}

/** Retry queued snapshots with exponential backoff (1, 2, 4 … 60 min). Called on 'online' and on app start. */
let backoff = 60_000;
export async function flushPending(): Promise<number> {
  if (running || !navigator.onLine || !driveConnected()) return 0;
  const snaps = await db.pendingSnapshots.filter(s => !s.id.startsWith('pre-restore')).toArray();
  let n = 0; running = true;
  try {
    for (const s of snaps) {
      const fid = await upload(s.blob, s.manifest as Manifest);
      await db.pendingSnapshots.delete(s.id);
      await db.backups.add({ id: uid('bk_'), provider: 'drive', backupTimestamp: (s.manifest as Manifest).createdAt, remoteFileId: fid, checksum: s.checksum, schemaVersion: (s.manifest as Manifest).schemaVersion, status: 'success', error: null, manifest: s.manifest, sizeBytes: s.blob.size });
      n++;
    }
    backoff = 60_000;
  } catch { setTimeout(() => flushPending(), backoff); backoff = Math.min(backoff * 2, 3_600_000); }
  finally { running = false; }
  return n;
}

/** Deletes oldest remote backups beyond `retention` — only if the user enabled AND confirmed a retention policy. */
export async function applyRetention() {
  const s = await loadSettings();
  if (!s.backup.retentionConfirmed || s.backup.retention < 1) return 0;
  const files = await listRemote(); const extra = files.slice(s.backup.retention);
  for (const f of extra) await api(`/drive/v3/files/${f.id}`, { method: 'DELETE' });
  return extra.length;
}
