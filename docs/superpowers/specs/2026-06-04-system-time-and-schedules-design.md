# System Time & Schedules Display — Design

**Date:** 2026-06-04
**Status:** Approved, pending implementation plan
**Builds on:** the v1 Pentair pool dashboard (`docs/superpowers/specs/2026-06-03-pentair-pool-controller-design.md`)

## Summary

Add two **read-only** pieces of controller information to the existing dashboard:
1. **System time** — the gateway's current clock, shown in the header, refreshed every poll.
2. **Schedules** — the controller's recurring and run-once schedules, shown as a card.

Both are retrieved from the ScreenLogic gateway `EE-59-51` over the existing
connection. This stays within the v1 read-only philosophy — no state-changing commands.
(The clock can drift: a live check on 2026-06-04 found the gateway 89 minutes ahead, so
displaying it lets drift be spotted at a glance.)

## Library capabilities (confirmed against installed node-screenlogic 2.1.1)

- `conn.equipment.getSystemTimeAsync()` → `SLSystemTimeData`:
  `{ date: Date, year, month, dayOfWeek, day, hour, minute, second, millisecond, adjustForDST }`.
- `conn.schedule.getScheduleDataAsync(scheduleType)` → `{ data: SLScheduleDatum[] }`,
  where `scheduleType` is `SchedTypes.RECURRING (0)` or `SchedTypes.RUNONCE (1)`.
  Each `SLScheduleDatum`: `{ scheduleId, circuitId, startTime, stopTime, dayMask, flags,
  heatCmd, heatSetPoint, days }`.

Real data captured from `EE-59-51` (2026-06-04): 3 recurring schedules, 0 run-once.
`startTime`/`stopTime` arrive as `"HHMM"` strings (e.g. `"0900"`, `"0030"`); `days` is
pre-decoded into day-name strings by the library; `circuitId` uses the same circuit ids
already mapped to names from controller config (6=Pool, 2=Cleaner, 5=Yard Light).

## Architecture

Extends the existing read-only pipeline; no new architectural pattern. The session
enriches each status push with `systemTime` (fetched per poll) and `schedules`
(fetched once per connection, re-fetched on reconnect).

```
gatewaySession (on connect):  getControllerConfig ──┐
                              getSchedules (once) ───┤→ cache circuit names + schedules
gatewaySession (each poll):   getEquipmentState ─────┤
                              getSystemTime ─────────┘→ normalize → status{...,
                                                          systemTime, schedules } → SSE → browser
```

**Why this split:** the system clock advances continuously, so fetching it each poll
(the existing 5s cadence) keeps it accurate and surfaces drift. Schedules change rarely,
so fetching once per connection avoids needless calls.

### Module changes

- **`src/slAdapter.js`** (only file importing node-screenlogic) — add two thin wrappers,
  export names stable:
  - `getSystemTime(conn)` → `conn.equipment.getSystemTimeAsync()`
  - `getSchedules(conn)` → calls `conn.schedule.getScheduleDataAsync(0)` and `(1)`,
    returns `{ recurring, runOnce }` (the two `.data` arrays).
- **`src/normalize.js`** — add two pure functions:
  - `normalizeSystemTime(raw)` → `{ clock, adjustForDST }`.
  - `normalizeSchedules(recurring, runOnce, controllerConfig)` → array of
    `{ id, type, circuit, start, stop, days }`, joining `circuitId` → name using the same
    name map `normalizeStatus` builds, and formatting `"HHMM"` → `"HH:MM"`.
- **`src/gatewaySession.js`** — on connect, after `getControllerConfig`, also
  `getSchedules` once (best-effort). Each poll, also `getSystemTime` (best-effort).
  Attach normalized `systemTime` and cached `schedules` onto the status before emitting.
- **`src/server.js`** — unchanged; forwards the enriched status over SSE.
- **`public/index.html` + `public/app.js`** — render `s.systemTime` in the header next
  to the existing "updated" stamp, and `s.schedules` as a new card.

## Data shapes

**System time** — locale-independent wall-clock string (it is the controller's own local
time; no timezone conversion):
```js
{ clock: "2026-06-04 00:25", adjustForDST: true }   // zero-padded from year/month/day/hour/minute
```
Header shows `Controller 00:25`. Seconds are dropped (5s poll cadence). Refreshes per poll.

**Schedules:**
```js
[
  { id: 1, type: "recurring", circuit: "Pool",       start: "09:00", stop: "13:00", days: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] },
  { id: 2, type: "recurring", circuit: "Cleaner",    start: "09:30", stop: "11:30", days: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] },
  { id: 4, type: "recurring", circuit: "Yard Light", start: "21:00", stop: "00:30", days: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] }
]
```
- `type` is `"recurring"` or `"run-once"` depending on which list the entry came from.
- A `circuitId` with no matching config name uses the existing `"Circuit <id>"` fallback.
- `heatCmd`/`heatSetPoint` are intentionally NOT included (semantics unverified).

## Display

**Header:** the controller clock appears next to the existing "updated" timestamp, e.g.
`Controller 00:25`. If `systemTime` is absent from a push (best-effort miss), the header
keeps the last value / shows a dash.

**Schedules card** (in the existing card grid):
```
SCHEDULES
Pool          09:00–13:00   Every day
Cleaner       09:30–11:30   Every day
Yard Light    21:00–00:30   Every day
```
- Days: all 7 → "Every day"; otherwise the abbreviated list (e.g. `Mon Wed Fri`).
- Overnight ranges (stop < start, e.g. 21:00→00:30) display verbatim.
- Run-once entries show a small `once` tag.
- Empty list → "No schedules."

## Error handling (resilience-first)

A secondary call must never take down the live status pipeline:
- **Schedules** (once at connect): wrapped in try/catch. On failure, log, set `schedules`
  to `[]`, continue connecting. Re-fetched on reconnect.
- **System time** (each poll): wrapped individually. On failure, omit `systemTime` from
  that push (header keeps last value / dash) rather than triggering a reconnect.
- **`getEquipmentState` remains the sole connection-health signal** — only its failure
  drives teardown/reconnect (unchanged state-machine behavior). The two new calls never
  cause spurious reconnect churn.

## Testing

- **`normalizeSystemTime`** — unit-tested against a fixture of real raw fields; asserts
  zero-padded `clock` (incl. `hour:0 → "00"`, single-digit month/day) and `adjustForDST`.
- **`normalizeSchedules`** — unit-tested with the real captured 3-schedule data plus a
  controller-config name map; asserts name join, `"0900"→"09:00"` and `"0030"→"00:30"`
  formatting, `days`, and `type`. Extra cases: a run-once entry → `type:"run-once"`; a
  `circuitId` with no config name → `"Circuit <id>"` fallback.
- **`gatewaySession`** — update the injected adapter fake with `getSchedules`/
  `getSystemTime`; assert the emitted status carries `systemTime` and `schedules`; assert
  best-effort behavior (schedule fetch throws → status still emits with `schedules: []`;
  system-time throws → status still emits, `systemTime` omitted).
- **`slAdapter` wrappers** — not unit-tested (pure I/O), verified live against `EE-59-51`.
- **Frontend** — verified live in the browser (header clock + Schedules card render/update).
- New fixtures: `test/fixtures/systemTime.json`, `test/fixtures/schedules.json` from the
  real capture.

## Out of scope (deferred)

- Any write/state-changing commands, including **setting** the system time or editing
  schedules. (Setting the clock was done once as a manual corrective command on
  2026-06-04; a proper write-enabled "control" feature is a separate future spec.)
- Displaying or interpreting `heatCmd`/`heatSetPoint` on schedules.
- Drift detection/alerting (comparing gateway clock to a reference) — display only for now.
