# Backup & restore

## What's backed up
All MEDTRACK tables: catalogue metadata, progress, plans and tasks, MCQ logs, revisions, sessions, settings, audit, import history. **No video content and nothing from Marrow beyond titles and durations.**

## Archive format (`.mtbk`)
```json
{ "magic": "MEDTRACK-ENC-1",
  "manifest": { "app", "appVersion", "schemaVersion", "datasetVersion", "createdAt", "counts", "checksum": "sha256(plaintext)", "lastLocalChange" },
  "salt": "b64(16 B)", "iv": "b64(12 B)", "ct": "b64(AES-256-GCM ciphertext)" }
```
- The key is derived with PBKDF2-SHA256 (310,000 iterations) from your passphrase, using standard WebCrypto only. There's no custom crypto.
- The manifest is bound to the ciphertext as AES-GCM *additional authenticated data*, so editing it makes decryption fail.
- Restore checks: JSON integrity → magic → authenticated decryption → SHA-256 checksum → schema compatibility → preview.
- **Recovery strategy:** the passphrase is the only key. It's never stored or uploaded. Lose it and the backup can't be read, so keep it in a password manager. An unencrypted JSON export also exists for your own offline storage.

## Google Drive setup (optional, once per deployment)
1. In Google Cloud Console, create or select a project and enable the **Google Drive API**.
2. Under **APIs & Services → OAuth consent screen**, choose External and add the scope `.../auth/drive.appdata`. Add yourself as a test user, or publish the app.
3. Under **Credentials → Create credentials → OAuth client ID**, choose type **Web application**. Add **Authorized JavaScript origins**: `https://<your-project>.vercel.app` (plus `http://localhost:5173` for development).
4. In Vercel, under **Settings → Environment Variables**, set `VITE_GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com`, then redeploy.

Scope: **`drive.appdata` only**. Backups go to the hidden app-specific folder. MEDTRACK can't see your other files. You can delete the backups in Drive under Settings → Manage apps → MEDTRACK → Delete hidden app data.

## Behaviour
- **Back up now** uploads only after Drive returns a file ID, and only then records success.
- **Offline or failed upload:** the encrypted snapshot is stored locally in `pendingSnapshots` and retried when the browser fires `online`, on app start, or when you tap **Upload queued**. Retries back off from 1 minute up to 60 minutes. A single in-memory lock prevents overlapping jobs.
- **Expired or revoked token:** an HTTP 401 clears the in-memory token and asks you to reconnect.
- **Retention:** keep the newest *N* backups. Older remote files are deleted only after you click **Confirm** on the policy. Changing *N* turns the confirmation off again.
- **Disconnect** revokes the token. Local data is not touched.

## Restore & conflict rules
| Option | Effect |
|---|---|
| Save as copy | Downloads the decrypted backup and changes nothing |
| Merge | Adds records missing locally. For lecture progress, the version with the newer `lastUpdatedAt` wins. Nothing local is deleted. |
| Replace | Saves a **safety snapshot** of current data locally first, then replaces all tables in one transaction, after an explicit confirmation |

If local data changed after the backup was created, a warning appears before Replace.
