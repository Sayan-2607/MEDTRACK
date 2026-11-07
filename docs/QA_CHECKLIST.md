# QA: automated tests, manual checklist, results

## Automated (`npm test`): 59 tests, all passing

| Suite | Covers |
|---|---|
| calc.test.ts (18) | All five speeds (Appendix C, including 1.8x = 33 min 20 s), zero and large durations, no cumulative rounding drift across 1,733 items, precedence, accuracy, MCQ validation, inclusion vs completion (excluded items count as neither completed nor remaining) |
| scheduler.test.ts (18) | Crambook Day-1 reproduction, order preservation, off days on/off, deadline capacity, impossible deadline capped and warned, both inputs, max-daily cap, long video atomic overrun, split mode, pinned capacity, revisions inside capacity, determinism, priority tie-break, reschedule diff, speed change, availability change, forecast labelling |
| importer.test.ts (17) | Bundled catalogue: 1,733 valid records, 19 subjects, module counts and totals equal the independent report, source pages, unique IDs, 7 exact duplicates flagged, Ophthalmology 52 Main = 44.8 h (PDF figure), overflow and wrapped titles; blank, malformed, zero and implausible durations; CSV quoting; **transactional import, re-import preserving progress, overrides and inclusion; edited-record carry-over; rollback on failure**; encrypted backup round-trip, wrong passphrase, tampered manifest, corrupted JSON, checksum mismatch |
| analytics.test.ts (6) | Readiness re-normalisation and no-data handling, consistency, streak grace days, weak topics need evidence, reality check |

## End-to-end (Playwright, run on the production build)
Onboarding → import 1,733 records → home → create plan → complete a task → subject → lecture → log MCQ → analytics → revision, timer, audit, settings, backup → dark mode → **offline reload served by the service worker**. Result: passed, **0 console errors**. One real bug found and fixed during this run: MCQ validation wrongly checked text fields.

## Manual checklist (run on your deployment)
- [ ] Install as PWA on Android Chrome; app opens from the home-screen icon
- [ ] Airplane mode: open the app, browse, change speeds, tick lectures, log MCQs, create or recover plans, analytics, settings, local export. All should work.
- [ ] DevTools → Network while offline: no requests from core features
- [ ] Notifications: grant, deny, and re-enable in browser settings. Test reminders after the app has been closed (expect a catch-up reminder)
- [ ] Drive: connect, back up, list, restore (merge and replace), disconnect; wrong passphrase; go offline and back up (queued), then reconnect (uploads); revoke access at myaccount.google.com (expect a reconnect prompt); retention with and without confirmation
- [ ] Screen sizes: 360 px phone, tablet, desktop with side-rail navigation
- [ ] Accessibility: 140% font scale, keyboard navigation and focus rings, screen-reader labels on icon buttons, reduce-motion setting
- [ ] Re-import the bundled catalogue after making progress: 1,733 matched, 0 changed, progress intact

## Known limitations
See [ARCHITECTURE.md → Known limitations](ARCHITECTURE.md#known-limitations).
