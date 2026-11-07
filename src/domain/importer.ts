/**
 * Dataset import (spec §4–5): parse JSON / CSV / XLSX → normalised records → validate → diff against DB → commit
 * transactionally. PDF is handled by the offline extractor (tools/extract_crambook.py), whose JSON output is bundled.
 */
import type { ModuleType } from '../db/schema';

export interface RawRecord {
  id?: string; subject: string; moduleType: string; title: string; originalDurationMinutes: number | null;
  sourcePage?: number; sourceRow?: number; sourceOrder?: number; sourceRowId?: string;
}
export interface ParsedDataset { datasetVersion: string; fileName: string; records: RawRecord[]; subjectsMeta?: { name: string; sourceName: string; sourceOrder: number }[]; }
export interface ValidationIssue { type: string; severity: 'info' | 'warning' | 'error'; detail: string; ref: string | null; }
export interface NormRecord {
  id: string; subjectName: string; subjectSourceName: string; moduleType: ModuleType; title: string; seconds: number;
  sourcePage: number; sourceRow: number; sourceOrder: number; sourceRowId: string;
}

const MODS: Record<string, ModuleType> = { main: 'Main', revision: 'Revision', mcq: 'MCQ' };
const DISPLAY: Record<string, string> = { Opthalmology: 'Ophthalmology' };
export const normText = (s: string) => (s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();

/** Deterministic 12-hex id from normalised identity (FNV-1a 64 via BigInt — stable across devices). */
export function stableHash(s: string): string {
  let h = 0xcbf29ce484222325n; const p = 0x100000001b3n;
  for (const ch of new TextEncoder().encode(s)) { h ^= BigInt(ch); h = (h * p) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, '0').slice(0, 12);
}
export const subjectIdFor = (sourceName: string) => 'sub_' + stableHash('subject|' + normText(sourceName).toLowerCase());

export function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}

function tableToRecords(rows: unknown[][]): RawRecord[] {
  const head = rows[0].map(h => String(h ?? '').trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex(h => names.includes(h));
  const ci = { id: col('id'), subject: col('subject'), module: col('moduletype', 'module', 'module type', 'type'), title: col('title'),
    dur: col('originaldurationminutes', 'duration', 'minutes', 'time @1x (min)', 'length @1x (min)'), page: col('sourcepage', 'page'),
    row: col('sourcerow'), order: col('sourceorder', 'order') };
  if (ci.subject < 0 || ci.title < 0 || ci.dur < 0) throw new Error('Missing required columns: subject, title, duration (minutes). Found: ' + head.join(', '));
  return rows.slice(1).map((r, i) => {
    const num = (k: number) => (k >= 0 && r[k] !== '' && r[k] != null ? Number(r[k]) : undefined);
    const d = num(ci.dur);
    return { id: ci.id >= 0 ? String(r[ci.id] ?? '') || undefined : undefined, subject: String(r[ci.subject] ?? ''), moduleType: ci.module >= 0 ? String(r[ci.module] ?? 'Main') : 'Main',
      title: String(r[ci.title] ?? ''), originalDurationMinutes: d === undefined || Number.isNaN(d) ? null : d,
      sourcePage: num(ci.page), sourceRow: num(ci.row) ?? i + 1, sourceOrder: num(ci.order) };
  });
}

export async function parseFile(file: File): Promise<ParsedDataset> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.json')) return parseJSON(await file.text(), file.name);
  if (name.endsWith('.csv')) return { datasetVersion: 'csv-' + file.name, fileName: file.name, records: tableToRecords(parseCSV(await file.text())) };
  if (name.endsWith('.xlsx')) {
    const { default: readXlsx } = await import('read-excel-file');
    const rows = await readXlsx(file);
    return { datasetVersion: 'xlsx-' + file.name, fileName: file.name, records: tableToRecords(rows as unknown[][]) };
  }
  if (name.endsWith('.pdf')) throw new Error('On-device PDF table extraction is not reliable enough for this catalogue (overflowing cells, wrapped titles). Use the bundled validated catalogue, or run tools/extract_crambook.py on your PDF and import the JSON/CSV it produces.');
  throw new Error('Unsupported file type. Use JSON, CSV or XLSX.');
}

export function parseJSON(text: string, fileName: string): ParsedDataset {
  const j = JSON.parse(text);
  const vids = Array.isArray(j) ? j : j.videos;
  if (!Array.isArray(vids)) throw new Error('JSON must be an array of records or an object with a "videos" array.');
  return {
    datasetVersion: j.datasetVersion ?? 'json-' + fileName, fileName,
    subjectsMeta: j.subjects?.map((s: any) => ({ name: s.name, sourceName: s.sourceName ?? s.name, sourceOrder: s.sourceOrder })),
    records: vids.map((v: any) => ({ id: v.id, subject: v.subjectSource ?? v.subject, moduleType: v.moduleType ?? v.module, title: v.title,
      originalDurationMinutes: v.originalDurationMinutes ?? (v.originalDurationSeconds != null ? v.originalDurationSeconds / 60 : null),
      sourcePage: v.sourcePage, sourceRow: v.sourceRow, sourceOrder: v.sourceOrder, sourceRowId: v.sourceRowId }))
  };
}

export function validate(ds: ParsedDataset): { records: NormRecord[]; issues: ValidationIssue[]; rejected: RawRecord[] } {
  const issues: ValidationIssue[] = []; const out: NormRecord[] = []; const rejected: RawRecord[] = [];
  const orderBySubject = new Map<string, number>(); const idCount = new Map<string, number>();
  ds.records.forEach((r, i) => {
    const src = normText(r.subject); const title = normText(r.title);
    const mod = MODS[normText(r.moduleType).toLowerCase()];
    const ref = `row ${i + 1}${r.sourcePage ? ` (p.${r.sourcePage})` : ''}`;
    if (!src) { issues.push({ type: 'missing_subject', severity: 'error', detail: `${ref}: subject is blank`, ref }); rejected.push(r); return; }
    if (!title) { issues.push({ type: 'missing_title', severity: 'error', detail: `${ref}: title is blank`, ref }); rejected.push(r); return; }
    if (!mod) { issues.push({ type: 'invalid_module', severity: 'error', detail: `${ref}: module "${r.moduleType}" is not Main/Revision/MCQ`, ref }); rejected.push(r); return; }
    const d = r.originalDurationMinutes;
    if (d == null || !isFinite(d) || d < 0) { issues.push({ type: 'invalid_duration', severity: 'error', detail: `${ref} "${title}": duration missing or malformed`, ref }); rejected.push(r); return; }
    if (d === 0) issues.push({ type: 'zero_duration', severity: 'warning', detail: `${ref} "${title}": duration is 0 min`, ref });
    if (d > 300) issues.push({ type: 'implausible_duration', severity: 'warning', detail: `${ref} "${title}": ${d} min is unusually long`, ref });
    const order = (orderBySubject.get(src) ?? 0) + 1; orderBySubject.set(src, order);
    let id = r.id || 'vid_' + stableHash(`${src.toLowerCase()}|${mod.toLowerCase()}|${title.toLowerCase()}|${d}`);
    const n = (idCount.get(id) ?? 0) + 1; idCount.set(id, n);
    if (n > 1 && !r.id) id = `${id}_${n}`;
    out.push({ id, subjectSourceName: src, subjectName: DISPLAY[src] ?? src, moduleType: mod, title, seconds: Math.round(d * 60),
      sourcePage: r.sourcePage ?? 0, sourceRow: r.sourceRow ?? i + 1, sourceOrder: r.sourceOrder ?? order, sourceRowId: r.sourceRowId ?? `p${r.sourcePage ?? 0}r${r.sourceRow ?? i + 1}` });
  });
  // duplicates
  const exact = new Map<string, NormRecord[]>(), probable = new Map<string, NormRecord[]>();
  for (const r of out) {
    const k = `${r.subjectSourceName}|${r.moduleType}|${r.title.toLowerCase()}`;
    (exact.get(k + '|' + r.seconds) ?? exact.set(k + '|' + r.seconds, []).get(k + '|' + r.seconds)!).push(r);
    (probable.get(k) ?? probable.set(k, []).get(k)!).push(r);
  }
  for (const [, rs] of exact) if (rs.length > 1) issues.push({ type: 'exact_duplicate', severity: 'warning', detail: `"${rs[0].title}" (${rs[0].subjectName}) appears ${rs.length}× with identical duration — kept all; exclude manually if redundant`, ref: rs.map(r => r.sourceRowId).join(', ') });
  for (const [, rs] of probable) { const ds2 = new Set(rs.map(r => r.seconds)); if (ds2.size > 1) issues.push({ type: 'probable_duplicate', severity: 'warning', detail: `"${rs[0].title}" (${rs[0].subjectName}) has differing durations: ${[...ds2].map(s => s / 60).join(', ')} min`, ref: rs.map(r => r.sourceRowId).join(', ') }); }
  return { records: out, issues, rejected };
}

export interface ImportDiff { added: NormRecord[]; changed: { rec: NormRecord; oldId: string }[]; unchanged: NormRecord[]; missing: { id: string; title: string }[]; }
/** Match by stable id first; then by (subject, module, sourceOrder) to detect edits. Missing records are archived, never deleted. */
export function diffAgainst(existing: { id: string; subjectId: string; moduleType: string; sourceOrder: number; title: string; active: boolean }[], recs: NormRecord[]): ImportDiff {
  const byId = new Map(existing.map(e => [e.id, e]));
  const byPos = new Map(existing.map(e => [`${e.subjectId}|${e.moduleType}|${e.sourceOrder}`, e]));
  const seen = new Set<string>(); const d: ImportDiff = { added: [], changed: [], unchanged: [], missing: [] };
  for (const r of recs) {
    if (byId.has(r.id)) { d.unchanged.push(r); seen.add(r.id); continue; }
    const pos = byPos.get(`${subjectIdFor(r.subjectSourceName)}|${r.moduleType}|${r.sourceOrder}`);
    if (pos && !seen.has(pos.id) && !recs.some(x => x.id === pos.id)) { d.changed.push({ rec: r, oldId: pos.id }); seen.add(pos.id); continue; }
    d.added.push(r);
  }
  for (const e of existing) if (!seen.has(e.id) && e.active) d.missing.push({ id: e.id, title: e.title });
  return d;
}

export function summarise(recs: NormRecord[]) {
  const bySubject = new Map<string, Record<string, { count: number; seconds: number }>>();
  for (const r of recs) {
    const s = bySubject.get(r.subjectName) ?? {}; const m = s[r.moduleType] ?? { count: 0, seconds: 0 };
    m.count++; m.seconds += r.seconds; s[r.moduleType] = m; bySubject.set(r.subjectName, s);
  }
  return bySubject;
}
