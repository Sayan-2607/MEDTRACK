/**
 * MEDTRACK local relational store (IndexedDB via Dexie).
 * Conventions:
 *  - Durations are stored as integer SECONDS everywhere (originalDurationSeconds, plannedSeconds ...).
 *  - Calendar dates are local 'YYYY-MM-DD' strings (time-zone safe for day bucketing).
 *  - Instants are epoch milliseconds (number).
 *  - Every schema change bumps the Dexie version with an explicit upgrade() — see docs/DATABASE.md.
 */
import Dexie, { type Table } from 'dexie';

export type ModuleType = 'Main' | 'Revision' | 'MCQ';
export type VideoStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped' | 'revisit';
export type Speed = 1 | 1.2 | 1.5 | 1.8 | 2;
export const SPEEDS: Speed[] = [1, 1.2, 1.5, 1.8, 2];

export interface Subject {
  id: string; name: string; sourceName: string; priority: number | null; sortOrder: number;
  sourceOrder: number; active: boolean; hidden: boolean; coverageStatus: string;
  defaultSpeed: Speed | null; createdAt: number; updatedAt: number;
}
export interface Video {
  id: string; subjectId: string; moduleType: ModuleType; title: string; originalDurationSeconds: number;
  sourcePage: number; sourceRow: number; sourceRowId: string; sourceOrder: number; manualOrder: number | null;
  datasetVersion: string; includedInPlan: boolean; active: boolean; tags: string[];
  examTags: ('NEET PG' | 'INI-CET')[]; topic: string | null; createdAt: number; updatedAt: number;
}
export interface VideoProgress {
  videoId: string; status: VideoStatus; speedOverride: Speed | null; completedAt: number | null;
  completedSpeed: Speed | null; actualTimeSeconds: number; notes: string; lastUpdatedAt: number;
}
export type PlanMode = 'balanced' | 'deadline' | 'flexible';
export interface StudyPlan {
  id: string; name: string; mode: PlanMode; startDate: string; targetDate: string | null;
  dailyTargetMinutes: number; maxDailyMinutes: number; offDays: number[]; allowOffDays: boolean;
  splitLongVideos: boolean; subjectIds: string[]; modules: ModuleType[]; includeRevisions: boolean;
  status: 'active' | 'paused' | 'archived'; createdAt: number; updatedAt: number;
}
export type TaskType = 'video' | 'revision' | 'mcq';
export interface ScheduledTask {
  id: string; planId: string; taskType: TaskType; videoId: string | null; revisionEventId: string | null;
  mcqLabel: string | null; scheduledDate: string; plannedSeconds: number; partIndex: number; partCount: number;
  status: 'pending' | 'done' | 'skipped' | 'removed'; pinned: boolean; manual: boolean; orderIndex: number;
  overrunSeconds: number; createdAt: number; updatedAt: number;
}
export interface McqSession {
  id: string; subjectId: string | null; topic: string; source: string; sessionDate: string;
  totalQuestions: number; attempted: number; correct: number; incorrect: number; skipped: number;
  durationSeconds: number; notes: string; completed: boolean; flagged: boolean; mistakes: string;
  markForRevision: boolean; origin: 'user' | 'import'; createdAt: number;
}
export interface McqTarget { id: string; subjectId: string | null; topic: string; targetQuestions: number; dailyTarget: number | null; }
export interface RevisionItem {
  id: string; refType: 'video' | 'topic'; videoId: string | null; topic: string | null; subjectId: string | null;
  intervals: number[] | null; anchorDate: string; createdAt: number; active: boolean;
}
export interface RevisionEvent {
  id: string; itemId: string; cycle: number; intervalDays: number; dueDate: string;
  status: 'due' | 'done' | 'skipped'; completedAt: number | null; confidence: number | null; notes: string;
}
export interface StudySession {
  id: string; startTime: number; endTime: number; durationSeconds: number;
  category: 'lecture' | 'mcq' | 'revision' | 'other'; linkedTaskId: string | null; videoId: string | null; notes: string; manual: boolean;
}
export interface ExamTarget { examType: 'NEET PG' | 'INI-CET'; targetDate: string | null; enabled: boolean; }
export interface AppSetting { key: string; value: unknown; updatedAt: number; }
export interface BackupRecord {
  id: string; provider: 'drive' | 'local'; backupTimestamp: number; remoteFileId: string | null; checksum: string;
  schemaVersion: number; status: 'pending' | 'success' | 'failed'; error: string | null; manifest: unknown; sizeBytes: number;
}
export interface ImportBatch {
  id: string; fileName: string; datasetVersion: string; importedAt: number; counts: Record<string, number>;
  report: unknown;
}
export interface ImportIssue { id: string; batchId: string; type: string; severity: 'info' | 'warning' | 'error'; detail: string; ref: string | null; }
export interface AuditEvent { id: string; at: number; entity: string; entityId: string; action: string; before: unknown; after: unknown; }
export interface Milestone { id: string; kind: 'subject' | 'mcq' | 'revision' | 'mock' | 'custom'; label: string; target: number; subjectId: string | null; dueDate: string | null; createdAt: number; }
export interface MockTest { id: string; date: string; name: string; score: number; maxScore: number; percentile: number | null; notes: string; }
export interface PendingSnapshot { id: string; createdAt: number; blob: Blob; checksum: string; manifest: unknown; }

export class MedtrackDB extends Dexie {
  subjects!: Table<Subject, string>;
  videos!: Table<Video, string>;
  progress!: Table<VideoProgress, string>;
  plans!: Table<StudyPlan, string>;
  tasks!: Table<ScheduledTask, string>;
  mcqSessions!: Table<McqSession, string>;
  mcqTargets!: Table<McqTarget, string>;
  revisionItems!: Table<RevisionItem, string>;
  revisionEvents!: Table<RevisionEvent, string>;
  studySessions!: Table<StudySession, string>;
  examTargets!: Table<ExamTarget, string>;
  settings!: Table<AppSetting, string>;
  backups!: Table<BackupRecord, string>;
  importBatches!: Table<ImportBatch, string>;
  importIssues!: Table<ImportIssue, string>;
  audit!: Table<AuditEvent, string>;
  milestones!: Table<Milestone, string>;
  mocks!: Table<MockTest, string>;
  pendingSnapshots!: Table<PendingSnapshot, string>;

  constructor(name = 'medtrack') {
    super(name);
    // v1 — initial schema. Indexed fields only; other fields are stored but not indexed.
    this.version(1).stores({
      subjects: 'id, sortOrder, priority, active',
      videos: 'id, subjectId, moduleType, [subjectId+moduleType], sourceOrder, includedInPlan, active, sourceRowId',
      progress: 'videoId, status, completedAt',
      plans: 'id, status, createdAt',
      tasks: 'id, planId, scheduledDate, [planId+scheduledDate], status, videoId, revisionEventId',
      mcqSessions: 'id, subjectId, sessionDate, topic',
      mcqTargets: 'id, subjectId, topic',
      revisionItems: 'id, videoId, topic, active',
      revisionEvents: 'id, itemId, dueDate, status',
      studySessions: 'id, startTime, category',
      examTargets: 'examType',
      settings: 'key',
      backups: 'id, backupTimestamp, status, provider',
      importBatches: 'id, importedAt',
      importIssues: 'id, batchId, type',
      audit: 'id, at, entity, entityId',
      milestones: 'id, kind',
      mocks: 'id, date',
      pendingSnapshots: 'id, createdAt'
    });
    // Future migrations: this.version(2).stores({...}).upgrade(tx => {...})
  }
}

export const SCHEMA_VERSION = 1;
export let db = new MedtrackDB();
export function _setDbForTests(d: MedtrackDB) { db = d; }

export const uid = (p = '') => p + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export async function audit(entity: string, entityId: string, action: string, before: unknown, after: unknown) {
  await db.audit.add({ id: uid('a_'), at: Date.now(), entity, entityId, action, before, after });
}
