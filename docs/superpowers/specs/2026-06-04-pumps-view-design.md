# Pumps View (Read-Only) — Design

**Date:** 2026-06-04
**Status:** Approved, pending implementation plan
**Builds on:** the interactive control panel + nav shell

## Summary

Add a read-only **Pumps** view showing the system's variable-speed pump: its identity,
live telemetry (running / RPM / watts / GPM), and its per-circuit programmed speed presets.
**No adjustment / write** — setting pump speeds is deliberately deferred until the owner has
the equipment details and a pool professional's input. The goal is purely to *see* the values.

## Context (confirmed live against EE-59-51)

- The system has **one** variable-speed pump. Probing pump ids 0/2/3 times out; only **pump
  id 1** responds.
- `getPumpStatusAsync(1)` returns `pumpType=3` → `PUMP_TYPE_INTELLIFLOVS` (**Pentair
  IntelliFlo VS**), `isRunning`, `pumpRPMs`, `pumpWatts`, `pumpGPMs`, and `pumpCircuits[]`
  (per-circuit `{circuitId, speed, isRPMs}`).
- Programmed `pumpCircuits` observed: Pool=2600, Spa=3450, Cleaner=2400, Spillway=2750
  (RPM), plus Aux 7=3450, internal ids 130=2700 / 132=610, and an empty slot id 0=1000.
- The gateway does **not** expose the exact pump model number, safe min/max RPM, pool
  volume, filter specs, or heater/cleaner minimum flow. Those determine "correct" RPMs and
  are out of scope here — hence read-only.

## Scope

**In scope:** a read-only Pumps view — pump identity, live telemetry, and the per-circuit
speed presets for the real water-moving circuits (Pool, Spa, Cleaner, Spillway).

**Out of scope (deferred to a future spec):** adjusting/writing pump speeds
(`setPumpSpeedAsync`). Revisit with pump nameplate/model, pool volume, filter max flow,
heater/cleaner min-flow, and a pool professional's guidance.

## Architecture

Mirrors the existing read-only patterns (nav view + best-effort per-poll fetch over SSE).
No write path, no new server endpoint.

- **Navigation:** add a third tab — **Control · Schedules · Pumps**.
- **`src/config.js`:** add `pumpId` (env `POOL_PUMP_ID`, default `1` — the probed pump;
  configurable so we never poll absent pump ids, which just time out).
- **`src/slAdapter.js`:** add `getPumpStatus(conn, pumpId)` →
  `conn.pump.getPumpStatusAsync(pumpId)` (read-only; only file importing node-screenlogic).
- **`src/normalize.js`:** add `normalizePump(rawPumpStatus, controllerConfig)`:
  ```js
  {
    model: 'IntelliFlo VS',            // from pumpType (3 → INTELLIFLOVS); unknown → 'Pump (type N)'
    running: false, rpm: 0, watts: 0, gpm: 0,   // live telemetry (pumpRPMs/pumpWatts/pumpGPMs)
    presets: [                          // per-circuit programmed speeds, REAL circuits only
      { circuitId: 6, circuit: 'Pool', rpm: 2600 },
      { circuitId: 1, circuit: 'Spa', rpm: 3450 },
      { circuitId: 2, circuit: 'Cleaner', rpm: 2400 },
      { circuitId: 7, circuit: 'Spillway', rpm: 2750 },
    ],
  }
  ```
  Presets are filtered by reusing the existing circuit-name map + the `Aux*/Feature*`
  hidden-circuit filter: keep a `pumpCircuit` only if its `circuitId` resolves to a real,
  non-hidden circuit name. For this system that yields exactly Pool/Spa/Cleaner/Spillway
  (Aux 7 filtered out; ids 130/132/0 are not real circuits). `circuitId` is retained so the
  view can highlight the currently-active preset. No hardcoded circuit names.
- **`src/gatewaySession.js`:** each poll, best-effort `getPumpStatus(conn, config.pumpId)`,
  normalize, and attach as `status.pump`. A failure omits `pump` from that push (like the
  system-time fetch) and never triggers reconnect — `getEquipmentState` stays the sole
  connection-health signal.
- **`src/server.js`:** unchanged; `pump` rides the existing SSE status.

## View

A read-only Pumps card:
- Header **IntelliFlo VS** with a status dot that lights when `running`.
- **Live telemetry:** running → show `RPM · Watts · GPM` prominently; off → "Off" with
  dashes/zeros. Refreshes each poll.
- **Programmed speeds** (labeled read-only) — one row per preset:
  `Pool 2600 RPM`, `Spa 3450 RPM`, `Cleaner 2400 RPM`, `Spillway 2750 RPM`.
- When running, the preset whose circuit is currently **on** (matched via `circuitId`
  against the status circuits) gets a subtle highlight.
- No controls anywhere — purely informational.

## Error handling

The pump fetch is best-effort and isolated, identical to the system-time pattern: a failure
omits `pump` from that status push, never tears down the connection, never blocks the live
status. The view simply shows nothing (or last value) until the next successful poll.

## Testing

- **`normalizePump`** — unit-tested against a fixture built from the real probe payload:
  asserts `model: 'IntelliFlo VS'`, the live fields, and that `presets` is filtered to
  exactly Pool/Spa/Cleaner/Spillway (Aux 7 and ids 130/132/0 excluded). Plus an
  unknown-`pumpType` case → `Pump (type N)`.
- **`config.js`** — `POOL_PUMP_ID` default `1`, env-overridable (unit-tested with the other
  config values).
- **`slAdapter.getPumpStatus`** — not unit-tested (pure I/O); verified live.
- **`gatewaySession`** — best-effort pump fetch: emitted status carries `pump`; a
  pump-status failure omits `pump` but the status still emits and no reconnect occurs.
- **Frontend** — verified live: the Pumps tab renders the card + the four presets; `/status`
  carries the `pump` block. Live RPM/watts/GPM appear when the pool actually runs.

## Known limitations

- Inherits the app's LAN-only, no-auth posture (read-only here, so no new actuation risk).
- Single pump id is config-driven (default 1, the probed pump); systems with multiple pumps
  would need the id list generalized — out of scope for this single-pump system.
