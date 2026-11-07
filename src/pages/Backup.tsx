import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { patchSettings, type Settings } from '../data/settings';
import { buildArchive, openArchive, restoreReplace, restoreMerge, download, recordLocalBackup, lastLocalChange, type OpenedArchive } from '../backup/archive';
import * as drive from '../backup/drive';
import { Modal, Confirm, useToast } from '../ui/components';

export default function Backup({ s }: { s: Settings }) {
  const toast = useToast();
  const history = useLiveQuery(() => db.backups.orderBy('backupTimestamp').reverse().limit(30).toArray(), []);
  const pending = useLiveQuery(() => db.pendingSnapshots.toArray(), []);
  const issues = useLiveQuery(() => db.importIssues.where('type').anyOf('invalid_duration', 'exact_duplicate', 'probable_duplicate', 'overflow_repaired').count(), []);
  const [pass, setPass] = useState(''); const [pass2, setPass2] = useState('');
  const [connected, setConnected] = useState(drive.driveConnected());
  const [remote, setRemote] = useState<drive.RemoteBackup[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const [opened, setOpened] = useState<OpenedArchive | null>(null); const [restorePass, setRestorePass] = useState(''); const [rawText, setRawText] = useState<string | null>(null);
  const [localChange, setLocalChange] = useState(0); const [confirmReplace, setConfirmReplace] = useState(false);
  const [integrity, setIntegrity] = useState<string | null>(null);
  useEffect(() => { lastLocalChange().then(setLocalChange); }, [opened]);
  const passOk = pass.length >= 8 && pass === pass2;
  const lastOk = history?.find(h => h.status === 'success'); const lastErr = history?.find(h => h.status === 'failed');

  async function run<T>(label: string, f: () => Promise<T>) { setBusy(label); setErr(null); try { return await f(); } catch (e: any) { setErr(e.message); } finally { setBusy(null); } }
  async function checkIntegrity() {
    await run('check', async () => {
      const v = await db.videos.toArray(); const ids = new Set(v.map(x => x.id)); const subs = new Set((await db.subjects.toArray()).map(x => x.id));
      const orphanP = (await db.progress.toArray()).filter(p => !ids.has(p.videoId)).length; const orphanV = v.filter(x => !subs.has(x.subjectId)).length;
      const badDur = v.filter(x => !(x.originalDurationSeconds >= 0)).length;
      const msg = `Checked ${new Date().toLocaleString()}: ${v.length} videos, ${orphanP} orphan progress rows, ${orphanV} videos without subject, ${badDur} invalid durations.`;
      localStorage.setItem('mt_integrity', msg); setIntegrity(msg);
    });
  }
  useEffect(() => { try { setIntegrity(localStorage.getItem('mt_integrity')); } catch { /* ignore */ } }, []);

  return (
    <div className="stack">
      <h1>Backup & restore</h1>
      <div className="card stack"><h2>Data health</h2>
        <div className="kpis">
          <div className="kpi"><div className="v" style={{ fontSize: '.95rem' }}>{lastOk ? new Date(lastOk.backupTimestamp).toLocaleString() : 'Never'}</div><div className="l">last successful backup ({lastOk?.provider ?? '—'})</div></div>
          <div className="kpi"><div className="v">{pending?.filter(p => !p.id.startsWith('pre-restore')).length ?? 0}</div><div className="l">pending (queued) backups</div></div>
          <div className="kpi"><div className="v">{issues ?? 0}</div><div className="l">dataset validation notes</div></div>
        </div>
        {lastErr && (!lastOk || lastErr.backupTimestamp > lastOk.backupTimestamp) && <div className="banner bad small">Last error: {lastErr.error}</div>}
        <div className="small muted">{integrity ?? 'No local integrity check yet.'}</div>
        <div><button className="btn sm" disabled={!!busy} onClick={checkIntegrity}>Run integrity check</button></div>
      </div>

      <div className="card stack"><h2>Encryption passphrase</h2>
        <p className="small muted" style={{ margin: 0 }}>Backups are encrypted on this device (AES-256-GCM, key derived with PBKDF2-SHA256, 310,000 iterations) before they leave it. The passphrase is never stored or uploaded. <b>If you lose it, encrypted backups can't be recovered.</b> Keep it in a password manager.</p>
        <div className="grid-2"><input type="password" placeholder="Passphrase (min 8 chars)" value={pass} onChange={e => setPass(e.target.value)} autoComplete="new-password" /><input type="password" placeholder="Repeat passphrase" value={pass2} onChange={e => setPass2(e.target.value)} autoComplete="new-password" /></div>
        {pass && pass2 && pass !== pass2 && <div className="small" style={{ color: 'var(--bad)' }}>Passphrases don't match.</div>}
      </div>

      <div className="card stack"><h2>Local backup file</h2>
        <div className="row"><button className="btn primary" disabled={!passOk || !!busy} onClick={() => run('local', async () => { const { blob, manifest } = await buildArchive(pass); download(blob, `medtrack-${new Date().toISOString().slice(0, 16).replace(':', '')}.mtbk`); await recordLocalBackup(manifest, blob.size); toast('Encrypted backup downloaded'); })}>Download encrypted backup</button>
          <button className="btn" disabled={!!busy} onClick={() => run('plain', async () => { const { blob, manifest } = await buildArchive(null); download(blob, `medtrack-plain-${new Date().toISOString().slice(0, 10)}.json`); await recordLocalBackup(manifest, blob.size); })}>Unencrypted export</button>
          <label className="btn">Restore from file…<input type="file" accept=".mtbk,.json" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) { setRawText(await f.text()); setOpened(null); setRestorePass(''); } e.target.value = ''; }} /></label></div>
      </div>

      <div className="card stack"><h2>Google Drive (optional)</h2>
        {!drive.driveConfigured() ? <div className="banner warn small">This deployment has no Google OAuth client ID (<code>VITE_GOOGLE_CLIENT_ID</code>), so Drive backup is off. Local backup files work regardless. See docs/BACKUP.md.</div> : <>
          <p className="small muted" style={{ margin: 0 }}>Uses only the hidden app-data folder in your Drive (scope <code>drive.appdata</code>). MEDTRACK can't see your other Drive files. Disconnecting doesn't delete local data. The sign-in token lives in memory only and is never saved.</p>
          <div className="row">{connected ? <><span className="chip ok">Connected</span><button className="btn" onClick={() => { drive.disconnect(); setConnected(false); setRemote(null); }}>Disconnect</button></>
            : <button className="btn primary" disabled={!!busy} onClick={() => run('connect', async () => { await drive.connect(drive.wasLinked() ? '' : 'consent'); setConnected(true); setRemote(await drive.listRemote()); })}>{drive.wasLinked() ? 'Reconnect Google Drive' : 'Connect Google Drive'}</button>}</div>
          {connected && <>
            <div className="row"><button className="btn primary" disabled={!passOk || !!busy} onClick={() => run('drive', async () => { const r = await drive.backupNow(pass); toast(r.status === 'success' ? 'Backup uploaded and confirmed by Drive' : 'Offline: backup queued and will upload when you reconnect'); setRemote(await drive.listRemote()); })}>{busy === 'drive' ? 'Uploading…' : 'Back up now'}</button>
              <button className="btn" disabled={!!busy || !pending?.length} onClick={() => run('flush', async () => toast(`${await drive.flushPending()} queued backup(s) uploaded`))}>Upload queued</button>
              <button className="btn" disabled={!!busy} onClick={() => run('list', async () => setRemote(await drive.listRemote()))}>Refresh list</button></div>
            <label className="row small"><input type="checkbox" checked={s.backup.autoDaily} onChange={e => patchSettings({ backup: { ...s.backup, autoDaily: e.target.checked } })} />Remind me to back up daily (the browser can't run unattended background uploads; MEDTRACK prompts you when it opens)</label>
            <div className="row small"><span>Keep the newest {s.backup.retention} backups.</span>{s.backup.retentionConfirmed ? <><span className="chip ok">policy active</span><button className="btn sm" onClick={() => patchSettings({ backup: { ...s.backup, retentionConfirmed: false } })}>Disable</button></> : <button className="btn sm" onClick={() => patchSettings({ backup: { ...s.backup, retentionConfirmed: true } })}>Confirm: delete older remote backups</button>}</div>
            {remote && <div className="list">{remote.length ? remote.map(f => <div key={f.id} className="li small"><span className="grow">{new Date(f.createdTime).toLocaleString()} · {(Number(f.size) / 1024).toFixed(0)} KB · schema {f.appProperties?.schema}</span><button className="btn sm" disabled={!!busy} onClick={() => run('dl', async () => { setRawText(await drive.downloadRemote(f.id)); setOpened(null); })}>Restore…</button></div>) : <div className="small muted">No backups in Drive yet.</div>}</div>}
          </>}
        </>}
      </div>

      {err && <div className="banner bad small">{err}</div>}

      <div className="card"><details><summary>Backup history ({history?.length ?? 0})</summary><div className="list">{history?.map(h => <div key={h.id} className="li small"><span className="grow">{new Date(h.backupTimestamp).toLocaleString()} · {h.provider} · {(h.sizeBytes / 1024).toFixed(0)} KB</span><span className={'chip ' + (h.status === 'success' ? 'ok' : h.status === 'failed' ? 'bad' : 'warn')}>{h.status}</span>{h.error && <span className="tiny muted">{h.error}</span>}</div>)}</div></details></div>

      <Modal open={rawText != null} onClose={() => { setRawText(null); setOpened(null); }} title="Restore backup">
        {!opened ? <div className="stack">
          <input type="password" placeholder="Backup passphrase (blank for unencrypted)" value={restorePass} onChange={e => setRestorePass(e.target.value)} />
          <button className="btn primary" disabled={!!busy} onClick={() => run('open', async () => setOpened(await openArchive(rawText!, restorePass || null)))}>Verify & preview</button>
          <p className="tiny muted">The checksum and authenticated encryption are checked before anything changes.</p>
        </div> : <div className="stack small">
          <div className="banner ok">Integrity verified (SHA-256 checksum matches{opened.manifest.checksum ? '' : ''}).</div>
          <div>Created: <b>{new Date(opened.manifest.createdAt).toLocaleString()}</b> · app {opened.manifest.appVersion} · schema v{opened.manifest.schemaVersion} · dataset {opened.manifest.datasetVersion ?? '—'}</div>
          <div className="muted">{Object.entries(opened.manifest.counts).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>
          {localChange > opened.manifest.lastLocalChange && <div className="banner warn">Your local data has changes newer than this backup (last local change {new Date(localChange).toLocaleString()}). Replacing would lose them.</div>}
          <div><b>Conflict rules.</b> <i>Merge</i> adds records that are missing locally and, for lecture progress, keeps whichever version was updated more recently. Nothing local is deleted. <i>Replace</i> first saves a safety snapshot of your current data on this device, then swaps in the backup. <i>Save as copy</i> downloads the decrypted backup as a file without changing anything.</div>
          <div className="row"><button className="btn" onClick={() => download(new Blob([JSON.stringify({ magic: 'MEDTRACK-PLAIN-1', manifest: opened.manifest, data: opened.tables })]), 'medtrack-restored-copy.json')}>Save as copy</button>
            <button className="btn primary" disabled={!!busy} onClick={() => run('merge', async () => { await restoreMerge(opened); toast('Merged'); setRawText(null); setOpened(null); })}>Merge</button>
            <button className="btn danger" onClick={() => setConfirmReplace(true)}>Replace local data</button></div>
        </div>}
      </Modal>
      <Confirm open={confirmReplace} onClose={() => setConfirmReplace(false)} danger title="Replace all local data?" body="A safety snapshot of your current data is kept on this device first. All current records are then replaced by the backup." confirmLabel="Replace" onConfirm={() => run('replace', async () => { await restoreReplace(opened!); toast('Restored'); setRawText(null); setOpened(null); setTimeout(() => location.reload(), 600); })} />
    </div>
  );
}
