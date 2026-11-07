# Scheduling engine

`src/domain/scheduler.ts`: pure and deterministic, with no network, AI or randomness.

## Inputs
- Ordered tasks: subjects sorted by **priority ascending** (1 first), then subjects with no priority in **sortOrder** (ties broken by name). Within a subject: manual order, then module (Main → Revision → MCQ), then **source order**. Completed, skipped and excluded videos are dropped.
- Task duration = original seconds ÷ effective speed (override → subject → global).
- Due revision events (20-minute blocks by default), which can't be placed before their due date.
- Config: start date, daily target, max daily, off days, allow-off-days, target date, mode, split.

## Capacity by mode
```
cap = dailyTarget
if mode == flexible and ≥7 of last 14 days logged:  cap = min(dailyTarget, max(1.1 × recentMeanActual, 15 min))
if targetDate:
    needed = (workload + pinned) / studyDaysBetween(start, target)
    deadline mode (or no daily target): cap = needed; if needed > max → cap = max, warn "deadline will be missed"
    balanced mode: cap = min(dailyTarget, needed); warn if needed > dailyTarget
    flexible mode: warn if needed > cap
cap = min(cap, maxDaily)                 # backlog never pushes past the user's limit
```

## Placement
```
perDay = pinned/manual tasks already on the calendar
for each revision (by due date):  d = first study day ≥ due with used(d) < cap;  place; used += len
d = first study day ≥ start
for each video in order:
    if split:  fill (cap − used(d)) on d, carry the remainder to the next study day(s)
    else:      while used(d) ≥ cap: d = next study day
               place the WHOLE video on d (atomic). overrun = max(0, used(d) + len − cap) → disclosed
finish = last placement date; warnings for overruns, too-long videos and a missed target date
```
This matches the Crambook's own rule ("a video is placed on the day it starts"). Test `reproduces the Crambook rule` checks PDF Day 1: 6 videos, 2.60 h at 1.8x / 2.00 h.

## Examples
- 10 × 60 min, deadline in 5 days, deadline mode → capacity 120 min/day, finishes on time.
- 40 × 60 min, deadline tomorrow, max 4 h → capped at 4 h/day, with warnings "deadline will be missed" and "N days late".
- One 300-minute video at 120 min/day → atomic: one day with +180 min overrun and a warning. Split: 120 + 120 + 60.

## Missed tasks and recovery
- A task not done by its date stays **pending** and shows as **overdue** (preparation debt).
- **Recovery plan** (`previewReschedule`): rebuild from today, leave **pinned** and **manually moved** tasks in place (they use up capacity first), re-place everything else in the same order and within the same capacity limits. The preview shows tasks moved, new workload per day, old vs new finish, and conflicts.
- **Apply suggested changes** marks the old placements `removed` (kept for history) and inserts the new ones. **Keep my schedule** changes nothing.
- Backlog only clears through completion, explicit skip or removal, and each is written to the audit log.
- Speed, availability or import changes take effect on the next preview or regeneration. Existing tasks are never silently rewritten.
- A new plan pauses the previous one and never deletes it.

## Forecasts
With 7+ days of actual time: expected = mean pace, optimistic = max(mean, 75th percentile), conservative = min(mean, 25th percentile). With less history it gives a single workload-based estimate at the planned daily time, labelled as such.
