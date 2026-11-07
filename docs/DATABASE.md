# Database schema & migrations

IndexedDB database `medtrack`, managed by Dexie (`src/db/schema.ts`). Schema version **1**.

## Conventions
- **Durations:** integer **seconds** everywhere (`originalDurationSeconds`, `plannedSeconds`, `actualTimeSeconds`, `durationSeconds`). Estimates are computed as floats and rounded only for display.
- **Calendar dates:** local `YYYY-MM-DD` strings (time-zone safe for day bucketing). **Instants:** epoch milliseconds.
- Foreign keys are enforced in the repository layer (IndexedDB has no FK constraints); the Backup page's **integrity check** reports orphans.

## Tables (primary key, indexes)

| Table | PK | Indexes | Key fields |
|---|---|---|---|
| subjects | id | sortOrder, priority, active | name, sourceName, priority (1 = first), sortOrder, sourceOrder, hidden, coverageStatus, defaultSpeed |
| videos | id (stable hash) | subjectId, moduleType, [subjectId+moduleType], sourceOrder, includedInPlan, active, sourceRowId | title (original wording), originalDurationSeconds, sourcePage, sourceRow, sourceRowId, sourceOrder, manualOrder, datasetVersion, tags, examTags |
| progress | videoId | status, completedAt | status (not_started/in_progress/completed/skipped/revisit), speedOverride, completedAt, completedSpeed, actualTimeSeconds, notes, lastUpdatedAt |
| plans | id | status, createdAt | mode, startDate, targetDate, dailyTargetMinutes, maxDailyMinutes, offDays, subjectIds, modules, includeRevisions, splitLongVideos |
| tasks | id | planId, scheduledDate, [planId+scheduledDate], status, videoId, revisionEventId | taskType, plannedSeconds, partIndex/partCount, status (pending/done/skipped/removed), pinned, manual, overrunSeconds |
| mcqSessions | id | subjectId, sessionDate, topic | total, attempted, correct, incorrect, skipped, durationSeconds, flagged, mistakes, markForRevision, origin (user/import) |
| mcqTargets | id | subjectId, topic | targetQuestions, dailyTarget |
| revisionItems | id | videoId, topic, active | refType, intervals (null = global default), anchorDate |
| revisionEvents | id | itemId, dueDate, status | cycle, intervalDays, dueDate, status, completedAt, confidence, notes |
| studySessions | id | startTime, category | durationSeconds, videoId, manual |
| examTargets | examType | — | targetDate (nullable), enabled |
| settings | key | — | value, updatedAt |
| backups | id | backupTimestamp, status, provider | remoteFileId, checksum, schemaVersion, status, error, manifest |
| importBatches / importIssues | id | importedAt / batchId, type | fileName, datasetVersion, counts / type, severity, detail, ref |
| audit | id | at, entity, entityId | action, before, after |
| milestones, mocks | id | kind / date | targets and mock scores |
| pendingSnapshots | id | createdAt | queued encrypted backup blobs and pre-restore safety copies |

## How progress survives re-import
1. Video IDs are deterministic: `vid_` + hash(normalised subject | module | title | minutes). They don't depend on list position.
2. Progress is keyed by `videoId` in its own table, so a re-import never overwrites it.
3. The import diff classifies each record as **matched** (same ID: metadata refreshed, user flags kept), **changed** (same subject + module + source position but a different ID, i.e. an edited title or duration: progress is moved to the new ID and the old row is archived), **new**, or **missing** (archived only if the user ticks the box; never deleted).
4. The whole import is one transaction. Any error rolls back every write (tested).

## Migrations
Add a new `this.version(n).stores({...}).upgrade(tx => ...)` block. Never edit an existing version. Bump `SCHEMA_VERSION`. Backups record `schemaVersion`, and restore refuses archives newer than the app. Older archives restore into the current schema, and Dexie upgrades run on open.
