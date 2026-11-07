import { useState } from 'react';
import { db } from '../db/schema';
import { parseFile, parseJSON, validate, diffAgainst, summarise, type ParsedDataset, type NormRecord, type ValidationIssue, type ImportDiff } from '../domain/importer';
import { commitImport } from '../data/repo';
import { fmtHours } from '../domain/calc';
import { useToast } from '../ui/components';

type Step = 'choose' | 'preview' | 'done';
/** Source priorities found on the PDF dashboard (Medicine=1, OBGYN=2, Opthalmology=3). Imported as editable values. */
const BUNDLED_PRIORITIES: Record<string, number> = { Medicine: 1, OBGYN: 2, Opthalmology: 3 };

export function ImportWizard({ onDone, compact }: { onDone?: () => void; compact?: boolean }) {
  const [step, setStep] = useState<Step>('choose');
  const [ds, setDs] = useState<ParsedDataset | null>(null);
  const [recs, setRecs] = useState<NormRecord[]>([]);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [rejected, setRejected] = useState(0);
  const [diff, setDiff] = useState<ImportDiff | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [archiveMissing, setArchiveMissing] = useState(false);
  const [usePrio, setUsePrio] = useState(true);
  const [ack, setAck] = useState(false);
  const [report, setReport] = useState<any>(null);
  const toast = useToast();

  async function load(p: Promise<ParsedDataset>, withReport = false) {
    setErr(null); setBusy(true);
    try {
      const d = await p; const v = validate(d);
      const existing = await db.videos.toArray();
      setDs(d); setRecs(v.records); setIssues(v.issues); setRejected(v.rejected.length);
      setDiff(diffAgainst(existing, v.records));
      if (withReport) setReport(await (await fetch('/data/import_report.json')).json()); else setReport(null);
      setStep('preview');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function bundled() {
    await load(fetch('/data/marrow_catalogue.json').then(r => { if (!r.ok) throw new Error('Bundled catalogue not available offline yet — open the app once online.'); return r.text(); }).then(t => parseJSON(t, 'marrow_catalogue.json')), true);
  }
  async function commit() {
    if (!ds || !diff) return; setBusy(true);
    try {
      const reportIssues: ValidationIssue[] = report ? report.issues.filter((i: any) => i.type !== 'exact_duplicate').map((i: any) => ({ type: i.type, severity: i.type === 'overflow_repaired' ? 'warning' : 'info', detail: `${i.title} — ${i.detail}${i.page ? ` (p.${i.page})` : ''}`, ref: i.page ? 'p.' + i.page : null })) : [];
      await commitImport(ds.fileName, ds.datasetVersion, recs, diff, [...issues, ...reportIssues], { archiveMissing, subjectsMeta: ds.subjectsMeta, priorities: usePrio && report ? BUNDLED_PRIORITIES : undefined });
      toast(`Imported ${recs.length} records`); setStep('done'); onDone?.();
    } catch (e: any) { setErr('Import failed and was rolled back: ' + e.message); } finally { setBusy(false); }
  }

  if (step === 'choose') return (
    <div className="stack">
      <div className="card stack">
        <h3>Validated Marrow Crambook catalogue</h3>
        <p className="small muted" style={{ margin: 0 }}>Extracted offline from the supplied 23-page PDF: every row cross-checked against the text layer, with source page and row kept for each record.</p>
        <div><button className="btn primary" disabled={busy} onClick={bundled}>{busy ? 'Reading…' : 'Preview bundled catalogue'}</button></div>
      </div>
      <div className="card stack">
        <h3>Import a file</h3>
        <p className="small muted" style={{ margin: 0 }}>JSON (MEDTRACK format), CSV or XLSX with columns <code>subject, moduleType, title, originalDurationMinutes</code> (optional: id, sourcePage, sourceRow, sourceOrder). For a PDF, run <code>tools/extract_crambook.py</code> first. Parsing it reliably on the device isn't possible.</p>
        <input type="file" accept=".json,.csv,.xlsx,.pdf" aria-label="Choose dataset file" onChange={e => e.target.files?.[0] && load(parseFile(e.target.files[0]))} />
      </div>
      {err && <div className="banner bad">{err}</div>}
    </div>
  );

  if (step === 'done') return <div className="banner ok">Import complete. Your progress, inclusion flags and speed overrides were preserved for matching records.</div>;

  const sum = summarise(recs);
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity !== 'error');
  const total = recs.reduce((a, r) => a + r.seconds, 0);
  return (
    <div className="stack">
      <div className="card">
        <div className="card-h"><h3>Preview: {ds?.fileName}</h3><span className="chip">{ds?.datasetVersion}</span></div>
        <div className="kpis">
          <div className="kpi"><div className="v">{recs.length}</div><div className="l">valid records</div></div>
          <div className="kpi"><div className="v">{sum.size}</div><div className="l">subjects</div></div>
          <div className="kpi"><div className="v">{fmtHours(total)}</div><div className="l">total @1x</div></div>
          <div className="kpi"><div className="v">{rejected}</div><div className="l">rejected rows</div></div>
        </div>
        {report && <p className="small muted">Source: {report.pageCount} pages · {report.extractionMethod}. Sample-schedule rows in the PDF: {report.sampleSchedule.rows} ({Object.keys(report.sampleSchedule.subjects).join(', ')}), all matched in the master data. These sample selection flags are <b>not</b> imported as completion or plan choices.</p>}
      </div>
      {diff && <div className="card"><h3>Changes against your current catalogue</h3>
        <div className="kpis" style={{ marginTop: 8 }}>
          <div className="kpi"><div className="v">{diff.added.length}</div><div className="l">new</div></div>
          <div className="kpi"><div className="v">{diff.changed.length}</div><div className="l">changed (progress carried)</div></div>
          <div className="kpi"><div className="v">{diff.unchanged.length}</div><div className="l">matched by stable ID</div></div>
          <div className="kpi"><div className="v">{diff.missing.length}</div><div className="l">missing from file</div></div>
        </div>
        {diff.missing.length > 0 && <label className="row small" style={{ marginTop: 10 }}><input type="checkbox" checked={archiveMissing} onChange={e => setArchiveMissing(e.target.checked)} /> Archive the {diff.missing.length} missing records (kept with their progress, hidden from plans; never deleted)</label>}
      </div>}
      <div className="card scroll-x">
        <h3 style={{ marginBottom: 8 }}>By subject and module</h3>
        <table className="t"><thead><tr><th>Subject</th><th className="r">Main</th><th className="r">Revision</th><th className="r">MCQ disc.</th><th className="r">Hours @1x</th></tr></thead>
          <tbody>{[...sum].map(([s, m]) => <tr key={s}><td>{s}</td>{(['Main', 'Revision', 'MCQ'] as const).map(k => <td key={k} className="r">{m[k]?.count ?? 0}</td>)}<td className="r">{(Object.values(m).reduce((a, x) => a + x.seconds, 0) / 3600).toFixed(1)}</td></tr>)}</tbody></table>
        <p className="tiny muted">"MCQ" rows are MCQ <b>Discussion videos</b>, not QBank question counts.</p>
      </div>
      <div className="card">
        <details><summary>Sample of lecture titles ({Math.min(12, recs.length)} of {recs.length})</summary>
          <div className="list">{recs.slice(0, 12).map(r => <div className="li small" key={r.id}><span className={'chip ' + r.moduleType}>{r.moduleType}</span><span className="grow">{r.title}</span><span className="muted num">{r.seconds / 60} min · p.{r.sourcePage}</span></div>)}</div></details>
        <details open={errors.length > 0}><summary>Validation: {errors.length} errors, {warnings.length + (report?.issues.length ?? 0)} warnings/notes</summary>
          <div className="stack small" style={{ maxHeight: 280, overflow: 'auto' }}>
            {[...errors, ...warnings].map((i, k) => <div key={k}><span className={'chip ' + (i.severity === 'error' ? 'bad' : 'warn')}>{i.type}</span> {i.detail}</div>)}
            {report?.issues.filter((i: any) => i.type !== 'exact_duplicate').map((i: any, k: number) => <div key={'r' + k}><span className={'chip ' + (i.type === 'overflow_repaired' ? 'warn' : '')}>{i.type}</span> p.{i.page}: {i.title} — {i.detail}</div>)}
          </div></details>
      </div>
      {report && <label className="row small"><input type="checkbox" checked={usePrio} onChange={e => setUsePrio(e.target.checked)} /> Use the source's subject priorities (Medicine 1, OBGYN 2, Ophthalmology 3). You can edit these any time.</label>}
      {warnings.length > 0 && <label className="row small"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /> I reviewed the warnings above (duplicates are kept as separate records; you can exclude any of them later)</label>}
      {err && <div className="banner bad">{err}</div>}
      <div className="row"><button className="btn" onClick={() => setStep('choose')}>Back</button>
        <button className="btn primary" disabled={busy || !recs.length || (warnings.length > 0 && !ack)} onClick={commit}>{busy ? 'Importing…' : `Import ${recs.length} records`}</button></div>
      {!compact && <p className="tiny muted">The import runs in one database transaction: if anything fails, nothing changes.</p>}
    </div>
  );
}
