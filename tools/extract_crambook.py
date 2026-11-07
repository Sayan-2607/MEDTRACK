"""Phase 0: extract Marrow Crambook PDF -> canonical JSON + CSV + import report.
Usage: python3 extract_crambook.py <pdf> <outdir>"""
import sys, json, csv, hashlib, re, unicodedata
from collections import defaultdict, Counter
import pdfplumber

SUBJECTS = ["Anatomy","Physiology","Biochemistry","Pharmacology","Pathology","Microbiology",
 "Forensic Medicine","Opthalmology","ENT","SPM","Dermatology","Anesthesia","Psychiatry",
 "Radiology","Medicine","Surgery","OBGYN","Pediatrics","Orthopedics"]
MODULES = {"Main","Revision","MCQ"}

def norm(s): return re.sub(r"\s+"," ",unicodedata.normalize("NFKC",s or "")).strip()
def sid(name): return "sub_"+hashlib.sha1(norm(name).lower().encode()).hexdigest()[:10]

def main(pdf_path, outdir):
    pdf = pdfplumber.open(pdf_path)
    records, issues, sched, dash = [], [], [], {}
    order = Counter()
    for pno, page in enumerate(pdf.pages, 1):
        for table in page.extract_tables():
            for ri, row in enumerate(table):
                cells = [c if c is not None else "" for c in row]
                c0 = norm(cells[0])
                # dashboard rows (page 1)
                if pno == 1 and c0 in SUBJECTS:
                    nonempty = [norm(c) for c in cells[1:] if norm(c)]
                    dash[c0] = {"cells": nonempty, "page": pno}
                    continue
                if len(cells) >= 4 and c0 in SUBJECTS and norm(cells[1]) in MODULES:
                    raw_title = cells[2] or ""
                    wrapped = "\n" in raw_title
                    title = norm(raw_title.replace("\n"," "))
                    dur_raw = norm(cells[3]); sel_raw = norm(cells[4]) if len(cells)>4 else ""
                    repaired = False
                    try: dur = float(dur_raw)
                    except ValueError:
                        # long title overflowed into the duration (and sometimes selection) column.
                        spill = cells[3] or ""
                        if re.search(r"[A-Za-z]", sel_raw):
                            spill += " " + sel_raw; m = re.search(r"(\d)\s*$", sel_raw); sel_raw = m.group(1) if m else ""
                        digits = "".join(ch for ch in cells[3] if ch.isdigit())
                        text = re.sub(r"\d", "", spill.replace(sel_raw,"",0))
                        if re.search(r"[A-Za-z]", sel_raw or ""): sel_raw = ""
                        title = norm((raw_title + norm(re.sub(r"\s+(?=\S)", "", text) if False else text)).replace("\n"," "))
                        dur = float(digits) if digits else None
                        title = re.sub(r"\bDi scussion\b", "Discussion", title)  # undo glyph interleave artefact
                        repaired = True
                    order[c0]+=1
                    rec = {"subjectSource": c0, "moduleType": norm(cells[1]), "title": title,
                           "originalDurationMinutes": dur, "sourcePage": pno, "sourceRow": ri,
                           "sourceOrder": order[c0], "sampleSelected": sel_raw=="1",
                           "titleWrapped": wrapped, "overflowRepaired": repaired}
                    records.append(rec)
                    continue
                # daily schedule rows: #, day, date, weekday, subject, type, title, len, len@speed
                if len(cells) >= 9 and re.fullmatch(r"\d+", norm(cells[0])) and norm(cells[4]) in SUBJECTS:
                    sched.append({"n":int(norm(cells[0])),"subject":norm(cells[4]),"module":norm(cells[5]),
                                  "title":norm(cells[6].replace("\n"," ")),"min":float(norm(cells[7]) or 0),"page":pno})
    # fix rows where duration got merged into the title (e.g. 'MCQ65' + 'Discussion')
    for r in records:
        if r["originalDurationMinutes"] is None:
            issues.append({"type":"invalid_duration","page":r["sourcePage"],"title":r["title"],"detail":"duration not numeric"})
    # ids + duplicates
    seen = defaultdict(list)
    for r in records:
        key = f'{r["subjectSource"].lower()}|{r["moduleType"].lower()}|{r["title"].lower()}|{r["originalDurationMinutes"]}'
        base = hashlib.sha1(key.encode()).hexdigest()[:12]
        seen[key].append(r)
        n = len(seen[key])
        r["id"] = "vid_"+base+(f"_{n}" if n>1 else "")
        r["sourceRowId"] = f'p{r["sourcePage"]}r{r["sourceRow"]}'
        r["subjectId"] = sid(r["subjectSource"])
    for key, rs in seen.items():
        if len(rs)>1:
            issues.append({"type":"exact_duplicate","title":rs[0]["title"],"pages":[x["sourcePage"] for x in rs],"detail":f"{len(rs)} identical rows (kept all, distinct IDs)"})
    # probable duplicates: same subject+module+title, different duration
    tk = defaultdict(set)
    for r in records: tk[(r["subjectSource"],r["moduleType"],r["title"].lower())].add(r["originalDurationMinutes"])
    for k,v in tk.items():
        if len(v)>1: issues.append({"type":"probable_duplicate","title":k[2],"detail":f"{k[0]}/{k[1]} durations {sorted(x for x in v if x is not None)}"})
    for r in records:
        d=r["originalDurationMinutes"]
        if d is not None and (d<=0 or d>300):
            issues.append({"type":"implausible_duration","page":r["sourcePage"],"title":r["title"],"detail":f"{d} min"})
        if r.get("overflowRepaired"):
            issues.append({"type":"overflow_repaired","page":r["sourcePage"],"title":r["title"],"detail":f'title overflowed into duration column; duration {r["originalDurationMinutes"]} verified against layout text/rendered page; review recommended'})
        if r["titleWrapped"]:
            issues.append({"type":"wrapped_title_joined","page":r["sourcePage"],"title":r["title"],"detail":"multi-line cell joined (same table cell)"})
    # reconcile schedule
    idx = {(r["subjectSource"],r["title"].lower(),r["originalDurationMinutes"]) for r in records}
    only_sched = [s for s in sched if (s["subject"],s["title"].lower(),s["min"]) not in idx]
    # summaries
    by_sub = defaultdict(lambda: defaultdict(lambda: {"count":0,"minutes":0.0}))
    for r in records:
        b=by_sub[r["subjectSource"]][r["moduleType"]]; b["count"]+=1; b["minutes"]+= r["originalDurationMinutes"] or 0
    missing_subjects = [s for s in SUBJECTS if s not in by_sub]
    report = {
      "sourceFile": pdf_path.split("/")[-1], "pageCount": len(pdf.pages),
      "extractionMethod": "pdfplumber table extraction (cell-level, wrapped cells joined within a single table cell)",
      "recordCount": len(records),
      "countByModule": dict(Counter(r["moduleType"] for r in records)),
      "minutesByModule": {m: sum(r["originalDurationMinutes"] or 0 for r in records if r["moduleType"]==m) for m in MODULES},
      "bySubject": {s:{m:dict(v) for m,v in mods.items()} for s,mods in by_sub.items()},
      "totalMinutes": sum(r["originalDurationMinutes"] or 0 for r in records),
      "dashboardSubjects": SUBJECTS, "subjectsWithoutRecords": missing_subjects,
      "sampleSchedule": {"rows": len(sched), "subjects": dict(Counter(s["subject"] for s in sched)),
                          "minutes": sum(s["min"] for s in sched), "rowsNotMatchedInMasterData": only_sched},
      "sampleSettingsObserved": {"speed":"1.8x","dailyHours":2.0,"startDate":"2026-11-07","note":"sample workbook inputs, NOT user preferences"},
      "dashboardPriorities": {k:v["cells"] for k,v in dash.items()},
      "issues": issues,
      "notes": ["Subject spelled 'Opthalmology' in source; display name 'Ophthalmology', sourceName preserved.",
                "MCQ module rows are MCQ Discussion VIDEOS, not QBank question counts.",
                "sampleSelected flag = included in the PDF's sample schedule, NOT completion."]
    }
    display = {"Opthalmology":"Ophthalmology"}
    subjects = [{"id":sid(s),"name":display.get(s,s),"sourceName":s,"sourceOrder":i+1,
                 "coverageStatus": "complete_in_source" if s in by_sub else "no_records_in_source"} for i,s in enumerate(SUBJECTS)]
    dataset = {"datasetVersion":"crambook-2026-11-07-v1","generatedFrom":report["sourceFile"],"schemaVersion":1,
               "subjects":subjects,"videos":records}
    json.dump(dataset, open(f"{outdir}/marrow_catalogue.json","w"), indent=1, ensure_ascii=False)
    json.dump(report, open(f"{outdir}/import_report.json","w"), indent=1, ensure_ascii=False)
    with open(f"{outdir}/marrow_catalogue.csv","w",newline="",encoding="utf-8") as f:
        w=csv.writer(f); w.writerow(["id","subject","moduleType","title","originalDurationMinutes","sourcePage","sourceRow","sourceOrder","sampleSelected"])
        for r in records: w.writerow([r["id"],display.get(r["subjectSource"],r["subjectSource"]),r["moduleType"],r["title"],r["originalDurationMinutes"],r["sourcePage"],r["sourceRow"],r["sourceOrder"],int(r["sampleSelected"])])
    print(json.dumps({k:report[k] for k in ["pageCount","recordCount","countByModule","minutesByModule","totalMinutes","subjectsWithoutRecords"]},indent=1))
    print("issues:",Counter(i["type"] for i in issues))
    print("sched rows",len(sched),"unmatched",len(only_sched))
    for s,mods in by_sub.items(): print(s,{m:(v["count"],round(v["minutes"])) for m,v in mods.items()})
    for i in issues:
        if i["type"]!="wrapped_title_joined": print(i)

main(sys.argv[1], sys.argv[2])
