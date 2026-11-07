# Architecture

```
presentation   src/pages/*, src/ui/*            React 18 function components, live queries (dexie-react-hooks)
use cases      src/data/repo.ts, settings.ts    every mutation: one IndexedDB transaction + audit event
domain         src/domain/*                     pure, deterministic functions (calc, scheduler, importer, analytics, dates)
data           src/db/schema.ts                 Dexie (IndexedDB) relational store, versioned
platform       src/backup/*, src/notify.ts      WebCrypto, Google Identity Services + Drive REST, Notifications, Service Worker
```

The domain layer has no I/O and no clock reads (it receives `today`), so the logic is unit-testable and the scheduler is reproducible.

## Stack

| Concern | Choice |
|---|---|
| UI | React 18 + TypeScript, hand-written CSS design tokens (Material-3-like), no UI kit |
| Local DB | IndexedDB via Dexie 4 (indexes, compound indexes, transactions, versioned upgrades) |
| Offline | vite-plugin-pwa / Workbox: precaches the app shell and the bundled catalogue |
| Settings | Key/value rows in the `settings` table (typed defaults in `settings.ts`) |
| Charts | Hand-built SVG components (`ui/components.tsx`) drawn only from real data |
| XLSX import | `read-excel-file` (lazy-loaded) |
| Crypto | WebCrypto: PBKDF2-SHA256 → AES-256-GCM, SHA-256 checksums |
| Tests | Vitest + fake-indexeddb |

Dependencies (runtime): react, react-dom, react-router-dom, dexie, dexie-react-hooks, read-excel-file. No analytics or tracking SDKs.

## Supported platforms

Any evergreen browser with IndexedDB, Service Workers and WebCrypto: Chrome/Edge 100+, Android Chrome, Safari 16.4+ (iOS/macOS), Firefox 110+. Installable as a PWA.

## Permissions

| Permission | Why | When requested |
|---|---|---|
| Notifications | Local reminders | Onboarding step 5 or Settings, with an explanation; optional |
| Persistent storage | Ask the browser not to evict IndexedDB | Silently on start (`navigator.storage.persist()`) |
| File picker | Import/restore files the user chooses | Only when the user taps Import/Restore |

No camera, microphone, location, contacts or broad file access.

## Network destinations

| Destination | When |
|---|---|
| Your hosting origin (e.g. `*.vercel.app`) | Loading and updating the app's static files |
| `accounts.google.com` | Only after the user taps **Connect Google Drive** (loads Google Identity Services and shows consent) |
| `www.googleapis.com` | Only for Drive backup upload, list, download and delete in the `appDataFolder` |

The CSP in `vercel.json` enforces this list (`connect-src 'self' googleapis/oauth2/accounts`). Core features make **no network calls**. Test this by enabling airplane mode after the first load.

## Platform deviations

The spec targets native Android. Running as a hosted PWA changes these points:

| Spec item | Native requirement | This build |
|---|---|---|
| Room/SQLite, DataStore | Room | IndexedDB (Dexie) relational tables with indexes; settings in a key/value table |
| WorkManager background jobs | Guaranteed background work | Browsers can't run unattended background jobs without a push server, which the spec forbids. Backup retries run on `online` events and on app start, with exponential backoff. |
| Exact local notifications | AlarmManager / WorkManager | Reminders fire while the app is open or running in the background; missed ones are combined into one catch-up notification on next open. Stated in the UI. |
| Android Keystore | Hardware-backed key | The encryption key comes from a user passphrase (PBKDF2, 310k iterations) and is never stored. The OAuth token stays in memory only and is never written to disk. |
| Signed APK | Gradle signing | Not applicable. Installation is via the browser's "Install app" (PWA). See below for an APK route. |
| SAF document picker | Storage Access Framework | Standard `<input type=file>` and downloads |

**If you also need an APK:** wrap the deployed URL as a Trusted Web Activity with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) (`npx @bubblewrap/cli init --manifest https://<your-app>/manifest.webmanifest`, then `bubblewrap build`). That produces a signed APK/AAB for Play Store distribution, using the same code.

## Known limitations

- Data lives in one browser profile. Clearing site data deletes it, so keep backups. A different browser or device starts empty until you restore a backup.
- On-device PDF import is intentionally not offered. The PDF's table cells overflow and wrap in ways that need rendered-page checks. Use the bundled validated JSON, or run `tools/extract_crambook.py`.
- Reminder delivery depends on the browser and OS. iOS only shows web notifications for PWAs installed to the Home Screen (iOS 16.4+).
- Automatic daily Drive backup can't run unattended in a browser. MEDTRACK queues snapshots and uploads them when the app is open and online.
