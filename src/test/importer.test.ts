import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseJSON, parseCSV, validate, diffAgainst, stableHash, summarise } from '../domain/importer';
import { MedtrackDB, _setDbForTests, db } from '../db/schema';
import { commitImport, setVideoStatus, setSpeedOverride } from '../data/repo';
import { buildArchive, openArchive } from '../backup/archive';

const raw = readFileSync(new URL('../../public/data/marrow_catalogue.json', import.meta.url), 'utf8');
const report = JSON.parse(readFileSync(new URL('../../public/data/import_report.json', import.meta.url), 'utf8'));

describe('bundled Crambook catalogue', () => {
  const ds = parseJSON(raw, 'marrow_catalogue.json'); const v = validate(ds);
  it('all records valid, none rejected', () => { expect(v.rejected.length).toBe(0); expect(v.records.length).toBe(report.recordCount); });
  it('19 subjects present', () => expect(summarise(v.records).size).toBe(19));
  it('module counts match the independent extraction report', () => {
    const c: Record<string, number> = {}; for (const r of v.records) c[r.moduleType] = (c[r.moduleType] ?? 0) + 1;
    expect(c).toEqual(report.countByModule);
  });
  it('total minutes match report', () => expect(v.records.reduce((a, r) => a + r.seconds, 0) / 60).toBe(report.totalMinutes));
  it('every record keeps its source page', () => expect(v.records.every(r => r.sourcePage >= 2 && r.sourcePage <= 23)).toBe(true));
  it('IDs are unique', () => expect(new Set(v.records.map(r => r.id)).size).toBe(v.records.length));
  it('exact duplicates are flagged, not merged', () => expect(v.issues.filter(i => i.type === 'exact_duplicate').length).toBe(7));
  it('Ophthalmology: 52 Main (= PDF sample schedule) + Revision + MCQ', () => {
    const o = summarise(v.records).get('Ophthalmology')!;
    expect(o.Main.count).toBe(52); expect(o.Main.seconds / 3600).toBeCloseTo(44.8, 1); // PDF summary: 44.8 h @1x
    expect(o.Revision.count + o.MCQ.count).toBeGreaterThan(0);
  });
  it('overflowing titles repaired (e.g. Truncus Arteriosus 27 min)', () => {
    const r = v.records.find(x => x.title.includes('Truncus Arteriosus'))!; expect(r.seconds).toBe(27 * 60);
    expect(v.records.find(x => x.title.startsWith('Infectious Disease Epidemiology, Concept'))!.title.endsWith('MCQ Discussion')).toBe(true);
  });
  it('wrapped titles joined', () => expect(v.records.some(r => r.title === '9th, 10th, 11th and 12th Cranial Nerves')).toBe(true));
});

describe('validation edge cases', () => {
  it('flags blank, malformed, zero and implausible durations', () => {
    const v = validate({ datasetVersion: 't', fileName: 't', records: [
      { subject: 'ENT', moduleType: 'Main', title: 'A', originalDurationMinutes: null }, { subject: 'ENT', moduleType: 'Main', title: 'B', originalDurationMinutes: 0 },
      { subject: 'ENT', moduleType: 'Main', title: 'C', originalDurationMinutes: 900 }, { subject: 'ENT', moduleType: 'Bogus', title: 'D', originalDurationMinutes: 4 },
      { subject: 'ENT', moduleType: 'Main', title: 'E', originalDurationMinutes: -3 }, { subject: 'ENT', moduleType: 'Main', title: 'X', originalDurationMinutes: 10 }, { subject: 'ENT', moduleType: 'Main', title: 'x', originalDurationMinutes: 12 }] });
    expect(v.rejected.length).toBe(3);
    expect(v.issues.map(i => i.type)).toEqual(expect.arrayContaining(['invalid_duration', 'zero_duration', 'implausible_duration', 'invalid_module', 'probable_duplicate']));
  });
  it('CSV parser handles quotes and commas', () => expect(parseCSV('a,b\n"x, y","he said ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]));
  it('stable hash is deterministic', () => expect(stableHash('abc')).toBe(stableHash('abc')));
});

describe('transactional import & re-import', () => {
  beforeEach(async () => { const d = new MedtrackDB('test-' + Math.random()); _setDbForTests(d); await d.open(); });
  const ds = parseJSON(raw, 'marrow_catalogue.json'); const v = validate(ds);
  it('imports, then re-import preserves progress and overrides', async () => {
    await commitImport('f', ds.datasetVersion, v.records, diffAgainst([], v.records), v.issues, { archiveMissing: false, subjectsMeta: ds.subjectsMeta });
    expect(await db.videos.count()).toBe(v.records.length); expect(await db.subjects.count()).toBe(19);
    const id = v.records[10].id;
    await setVideoStatus(id, 'completed'); await setSpeedOverride([id], 2, false); await db.videos.update(id, { includedInPlan: false });
    const existing = await db.videos.toArray(); const d2 = diffAgainst(existing, v.records);
    expect(d2.unchanged.length).toBe(v.records.length); expect(d2.added.length).toBe(0);
    await commitImport('f2', ds.datasetVersion, v.records, d2, [], { archiveMissing: false });
    const p = await db.progress.get(id); expect(p?.status).toBe('completed'); expect(p?.speedOverride).toBe(2);
    expect((await db.videos.get(id))?.includedInPlan).toBe(false);
  });
  it('edited record (changed duration) carries progress to new id', async () => {
    await commitImport('f', 'v1', v.records, diffAgainst([], v.records), [], { archiveMissing: false });
    const target = v.records[0]; await setVideoStatus(target.id, 'completed');
    const edited = v.records.map((r, i) => (i === 0 ? { ...r, id: 'vid_new', seconds: r.seconds + 60 } : r));
    const d = diffAgainst(await db.videos.toArray(), edited); expect(d.changed.length).toBe(1);
    await commitImport('f2', 'v2', edited, d, [], { archiveMissing: false });
    expect((await db.progress.get('vid_new'))?.status).toBe('completed'); expect((await db.videos.get(target.id))?.active).toBe(false);
  });
  it('failed import rolls back completely', async () => {
    const bad = [...v.records.slice(0, 5), { ...v.records[5], seconds: undefined as any, subjectSourceName: undefined as any }];
    await expect(commitImport('bad', 'v', bad, diffAgainst([], bad), [], { archiveMissing: false })).rejects.toBeTruthy();
    expect(await db.videos.count()).toBe(0); expect(await db.importBatches.count()).toBe(0);
  });
  it('encrypted backup round-trips; wrong passphrase & tampering are rejected', async () => {
    await commitImport('f', 'v1', v.records.slice(0, 50), diffAgainst([], v.records.slice(0, 50)), [], { archiveMissing: false });
    const { blob } = await buildArchive('correct horse battery');
    const text = await blob.text();
    const o = await openArchive(text, 'correct horse battery'); expect(o.tables.videos.length).toBe(50);
    await expect(openArchive(text, 'wrong pass')).rejects.toThrow(/Decryption failed/);
    const j = JSON.parse(text); j.manifest.counts.videos = 999; await expect(openArchive(JSON.stringify(j), 'correct horse battery')).rejects.toThrow();
    await expect(openArchive('{not json', null)).rejects.toThrow(/corrupted/);
    const plain = JSON.parse(await (await buildArchive(null)).blob.text()); plain.data.videos.pop();
    await expect(openArchive(JSON.stringify(plain), null)).rejects.toThrow(/Checksum/);
  });
});
