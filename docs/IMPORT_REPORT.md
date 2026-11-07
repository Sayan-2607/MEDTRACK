# Phase 0 — Crambook PDF import & validation report

- **Source file:** `8bd99704-Copy_of_Marrow_Crambook.pdf` (23 pages)
- **Extraction method:** pdfplumber table extraction (cell-level, wrapped cells joined within a single table cell); every master-data row cross-checked against the PDF text layer (`pdftotext -layout`): 1,733 rows both ways.
- **Records extracted:** **1733**, rejected: 0
- **Total duration @1x:** 80322 min = **1338.7 h**

## By module

| Module | Videos | Minutes | Hours |
|---|---:|---:|---:|
| Main | 1311 | 57898 | 965.0 |
| Revision | 271 | 14185 | 236.4 |
| MCQ (MCQ Discussion videos) | 151 | 8239 | 137.3 |

## By subject

| Subject (source spelling) | Main | Revision | MCQ disc. | Total min | Total h |
|---|---:|---:|---:|---:|---:|
| Anatomy | 91 (3758m) | 12 (719m) | 5 (364m) | 4841 | 80.7 |
| Physiology | 62 (3148m) | 16 (989m) | 6 (330m) | 4467 | 74.5 |
| Biochemistry | 54 (2636m) | 11 (705m) | 14 (744m) | 4085 | 68.1 |
| Pharmacology | 75 (3581m) | 13 (636m) | 10 (315m) | 4532 | 75.5 |
| Pathology | 79 (3891m) | 15 (835m) | 6 (338m) | 5064 | 84.4 |
| Microbiology | 90 (2405m) | 14 (761m) | 8 (350m) | 3516 | 58.6 |
| Forensic Medicine | 44 (2076m) | 10 (446m) | 9 (368m) | 2890 | 48.2 |
| Opthalmology | 52 (2689m) | 12 (517m) | 6 (311m) | 3517 | 58.6 |
| ENT | 65 (2914m) | 15 (787m) | 10 (693m) | 4394 | 73.2 |
| SPM | 100 (3714m) | 18 (943m) | 11 (740m) | 5397 | 90.0 |
| Dermatology | 26 (892m) | 7 (260m) | 6 (242m) | 1394 | 23.2 |
| Anesthesia | 28 (1433m) | 9 (481m) | 6 (276m) | 2190 | 36.5 |
| Psychiatry | 22 (1007m) | 6 (275m) | 6 (396m) | 1678 | 28.0 |
| Radiology | 42 (1808m) | 9 (452m) | 8 (418m) | 2678 | 44.6 |
| Medicine | 204 (8090m) | 43 (2109m) | 5 (349m) | 10548 | 175.8 |
| Surgery | 84 (4103m) | 15 (771m) | 11 (488m) | 5362 | 89.4 |
| OBGYN | 113 (5973m) | 18 (1290m) | 12 (750m) | 8013 | 133.6 |
| Pediatrics | 55 (2477m) | 16 (873m) | 6 (388m) | 3738 | 62.3 |
| Orthopedics | 25 (1303m) | 12 (336m) | 6 (379m) | 2018 | 33.6 |

## Cross-checks against figures printed in the PDF

- The PDF's summary says the sample schedule is **52 videos, 44.8 h @1x**. Recomputed from extracted records: 52 Ophthalmology *Main* videos = 2,689 min = **44.8 h** ✔
- All 52 sample *Daily Schedule* rows match a master-data record (subject + title + duration). **No records exist only in the schedule.**
- **Ophthalmology coverage:** the 52 scheduled videos are the complete Ophthalmology *Main* module, but the catalogue also holds **12 Revision and 6 MCQ Discussion** videos (70 total). The sample schedule is therefore NOT the full Ophthalmology catalogue.
- All 19 dashboard subjects have master-data records (no subject has zero coverage).
- Source priorities on the dashboard: Medicine = 1, OBGYN = 2, Opthalmology = 3 (imported as editable values; optional at import time).
- Sample workbook inputs seen (1.8x, 2.00 h/day, start 07-Nov-2026, finish 19-Nov-2026) are **not** carried over as user preferences.

## Issues found

| Type | Count | Handling |
|---|---:|---|
| `wrapped_title_joined` | 19 | Multi-line text within a single table cell, joined with a space. These are unambiguous because the fragments share one cell. |
| `overflow_repaired` | 9 | The title overflowed into the duration column (e.g. `Truncus Arterio` + `sus 27`). Title rebuilt and duration taken from the trailing digits; each one checked against the layout text, and p.13 checked against the rendered page image. **Review recommended.** |
| `exact_duplicate` | 7 | Biochemistry (p.6): 7 MCQ Discussion rows appear twice with identical title and duration. **Kept as separate records** with distinct IDs (`…_2`). Exclude the copies from your plan if they're redundant. |
| missing/invalid durations | 0 | After repair. |

### Overflow-repaired rows

- p.4: Development of Inter-atrial, Inter-ventricular System and Truncus Arteriosus — duration 27.0 verified against layout text/rendered page
- p.6: Reproductive Physiology , Exercise physiology and Regulation of Body Temperature — duration 51.0 verified against layout text/rendered page
- p.7: ADR and Pharmacovigilance, Pharmacogenetics and Pharmacogenomics — duration 45.0 verified against layout text/rendered page
- p.8: Systemic Pathology: Gastrointestinal, Endocrine and Musculoskeletal System — duration 64.0 verified against layout text/rendered page
- p.10: Ocular Routes of Drug Administration, Blood Supply of Eye and Embryology of Eye — duration 69.0 verified against layout text/rendered page
- p.13: Infectious Disease Epidemiology, Concept of Prevention and Health Indicators MCQ Discussion — duration 65.0 verified against layout text/rendered page
- p.13: Health Care System of India and Health Planning and Management MCQ Discussion — duration 82.0 verified against layout text/rendered page
- p.14: Regional Anaesthesia, Anaesthesia Machines and Circuits, and Day Care Surgery — duration 85.0 verified against layout text/rendered page
- p.22: Metabolic Disorders, Joint Disorders and Orthopaedic Infections MCQ Discussion — duration 65.0 verified against layout text/rendered page

### Exact duplicates

- Enzymes MCQ Discussion (p.6)
- Carbohydrates MCQ Discussion (p.6)
- Lipids MCQ Discussion (p.6)
- Proteins and Amino Acids MCQ Discussion (p.6)
- Vitamins and Minerals MCQ Discussion (p.6)
- Molecular Biology MCQ Discussion (p.6)
- Biochemistry GT Discussion (p.6)

## Notes

- The subject is spelled **"Opthalmology"** in the source. The display name is "Ophthalmology"; `sourceName` keeps the original.
- `sampleSelected` in the JSON/CSV records whether a row was ticked in the PDF's *sample* schedule. It's not completion, and MEDTRACK doesn't import it as such.
- The PDF contains no QBank question counts and no personal completion history.
- Stable IDs: `vid_` + first 12 hex chars of SHA-1(`subject|module|title|minutes`), lower-cased; `_n` added for exact duplicates. `sourceRowId` = `p{page}r{tableRow}` is kept separately.

Outputs: `public/data/marrow_catalogue.json`, `public/data/marrow_catalogue.csv`, `public/data/import_report.json`. Regenerate with `python3 tools/extract_crambook.py <pdf> public/data` (needs `pip install pdfplumber`).
