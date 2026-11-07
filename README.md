# MEDTRACK

**An offline-first NEET PG and INI-CET preparation manager built with React, TypeScript, and IndexedDB.**

MEDTRACK helps medical aspirants organize lectures, track QBank performance, schedule daily study sessions, manage revision cycles, and monitor preparation progress through a single installable Progressive Web App (PWA).

The application follows a local-first architecture. Core functionality and study data run on the user's device, without requiring a backend or account.

## Features

- **Lecture Management:** Catalogue of 1,733 lectures across 19 subjects, with search, filters, sorting, tags, and progress tracking.
- **Study Tracking:** Track lecture status, playback speed, planned duration, and actual study time.
- **QBank Tracking:** Record question attempts, accuracy, targets, difficult questions, and mistake notes independently of lecture completion.
- **Revision Management:** Configurable spaced-repetition cycles with confidence ratings and overdue revision tracking.
- **Study Scheduler:** Deterministic Balanced, Deadline, and Flexible scheduling modes with priorities, off days, pinned tasks, and recovery plans.
- **Analytics:** Preparation readiness index, completion forecasts, weak-topic analysis, study heatmaps, mock-test tracking, and weekly reports.
- **Audit History:** Transaction-based updates with activity history and undo support.
- **Offline Support:** Installable PWA with local data storage and service-worker caching.
- **Encrypted Backup:** Optional AES-256-GCM encrypted backups through Google Drive.

## Tech Stack

- React
- TypeScript
- Vite
- IndexedDB
- Progressive Web App (PWA)
- AES-256-GCM
- Google Drive API
- Vitest
- Vercel

## Project Architecture

```text
MEDTRACK/
├── public/
│   └── data/
│       ├── marrow_catalogue.json
│       ├── marrow_catalogue.csv
│       └── import_report.json
├── src/
│   ├── db/
│   ├── domain/
│   ├── data/
│   ├── backup/
│   ├── pages/
│   └── test/
├── tools/
├── docs/
├── vercel.json
├── package.json
└── README.md
```

## Catalogue Statistics

| Metric | Count |
|---|---:|
| Lectures | 1,733 |
| Subjects | 19 |
| Total Duration | 1,338.7 hours at 1x |
| IndexedDB Tables | 19 |
| Automated Tests | 59 |

## Getting Started

### Prerequisites

- Node.js 18 or later
- npm

### Installation

```bash
git clone https://github.com/Sayan-2607/MEDTRACK.git
cd MEDTRACK
npm install
```

### Development

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

### Run Tests

```bash
npm test
```

### Production Build

```bash
npm run build
npm run preview
```

The production build is generated in the `dist/` directory.

## Deployment

MEDTRACK can be deployed on Vercel.

1. Import the GitHub repository into Vercel.
2. Select Vite as the framework preset.
3. Set the build command to `npm run build`.
4. Set the output directory to `dist`.
5. Click Deploy.

For optional Google Drive backup, configure the following environment variable:

```env
VITE_GOOGLE_CLIENT_ID=your_google_oauth_client_id
```

See [docs/BACKUP.md](docs/BACKUP.md) for configuration details.

## Privacy & Data Storage

MEDTRACK is designed with a privacy-first approach.

- Study data is stored locally using IndexedDB.
- No application backend is required.
- Core functionality works offline after initial caching.
- Google Drive integration is optional.
- Backup archives are encrypted using AES-256-GCM.
- No analytics or advertisements.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database Schema](docs/DATABASE.md)
- [Scheduling](docs/SCHEDULING.md)
- [Backup](docs/BACKUP.md)
- [User Guide](docs/USER_GUIDE.md)
- [QA Checklist](docs/QA_CHECKLIST.md)
- [Import Report](docs/IMPORT_REPORT.md)

## Platform Note

The original specification envisioned a native Kotlin/Android application. MEDTRACK is implemented as a React and TypeScript PWA to support web deployment through Vercel and installation across Android, iOS, and desktop.

The core principles of offline functionality, local data ownership, deterministic scheduling, transactional updates, audit history, and optional encrypted backup are retained. Platform-specific differences are documented in [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Author

**Sayan Ghosh**

- GitHub: [Sayan-2607](https://github.com/Sayan-2607)
- LinkedIn: [Sayan Ghosh](https://linkedin.com/in/sayan-g-600ab5307)
- Portfolio: [sxynn.vercel.app](https://sxynn.vercel.app)

---

**MEDTRACK** — Organize your preparation. Track your progress. Stay consistent.
