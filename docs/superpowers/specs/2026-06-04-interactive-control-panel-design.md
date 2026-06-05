# Interactive Control Panel — Design (Spec 1)

**Date:** 2026-06-04
**Status:** Approved, pending implementation plan
**Builds on:** the read-only pool dashboard (status + system time + schedules)

## Summary

Turn the dashboard from read-only into an **interactive control panel** for the Pentair
ScreenLogic gateway `EE-59-51`. This is the project's **first write feature**. It adds a
navigation shell with two views — **Control** (a polished hero-tile panel plus the existing
live status) and **Schedules** (the existing read-only schedule list relocated into its own
view). Full schedule *management* (add/edit/delete) is deferred to a separate spec (Spec 2).

Visual direction and interactions were validated via browser mockups: bold "glow zone
tiles," zone-colored glow for on-state, inline confirmation on guarded actions, lights
kept separate from body tiles.

## Scope

**In scope (Spec 1):**
- Navigation between **Control** and **Schedules** views.
- Controls: Pool on/off + heat setpoint, Spa on/off + heat setpoint, Spillway on/off,
  Pool Light on/off, Spa Light on/off, Yard Light ("On now" + timed "Extend").
- Write path: server command endpoint + session command method + adapter write wrappers.
- Optimistic UI with reconcile via the existing 5s status poll; zone-colored glow on-state;
  inline confirm on guarded actions.
- Schedules view = the current read-only schedule list moved into its own view.

**Out of scope (deferred to Spec 2 / later):**
- Schedule management (add/edit/enable-disable/delete).
- Light color modes/effects (`sendLightCommandAsync` color commands).
- Pumps, IntelliChlor, custom names, and other write surfaces.
- Authentication (see Known Limitations).

## Visual & interaction design (locked via mockups)

- **Direction:** "Glow Zone Tiles" — bold gradient tiles, app-like, mobile-first.
- **Order:** **Pool → Spillway → Spa**, then **Lights**.
- **Icons:** small emoji per control (🏊 Pool, ⛲ Spillway, ♨️ Spa, 💡 lights, 🌙 Yard);
  `⏱` schedule badge on schedule-driven controls (Pool, Yard Light).
- **On-state:** **zone-colored glow** (ring in the tile's own hue) + full color; **off** =
  dimmed/desaturated. Optional soft **pulse** during the pending window.
- **Lights are separate** from the body tiles (own "Lights" row): Pool Light + Spa Light
  manual on/off (low-traffic — night swimming is limited); **Yard Light** is schedule-driven,
  shown with its schedule plus **"On now"** and **"Extend +30m / +1 hr"** (no big toggle).
- **Cleaner** is not a control (rarely manual); it remains visible in the Schedules view.
- **Confirm style:** **inline** — a `✓ Turn on` / `Cancel` swap on the tile for guarded
  actions; setpoint uses a −/+ stepper then an **Apply** button.

## Architecture

First write path added alongside the existing read-only pipeline:

```
Browser (Control view)
   │  tap toggle / Apply setpoint / extend
   ▼  POST /api/command  {action, circuitId|body, value}
server.js ──► gatewaySession.sendCommand(fn) ──► slAdapter write ──► Gateway
                     │ (the ONE persistent connection, shared with polling)
   ◄───────────── next 5s status poll reflects the new state via SSE ──┘
```

- **Navigation shell:** client-side toggle between **Control** and **Schedules** views.
  No router; SSE keeps feeding both. The current status cards live under Control.
- **`gatewaySession.sendCommand(fn)`** — runs an adapter write on the live connection;
  rejects if not connected. Commands and polls share the single ScreenLogic connection
  (writes serialized through the session — no second connection).
- **`server.js` `POST /api/command`** — validates, calls `session.sendCommand`, returns
  success/failure. `/status` and `/events` unchanged.
- **`slAdapter` write wrappers** (only file importing node-screenlogic): `setCircuitState`,
  `setSetPoint`, `setCircuitRuntime`.
- **Optimistic + reconcile:** UI flips immediately with a pending shimmer; the next poll
  confirms ground truth (or snaps back). Reuses existing SSE — no new realtime channel.

### Circuit identity by name

The panel resolves each role (Pool, Spa, Spillway, Pool Light, Spa Light, Yard Light) to a
circuit **id** by case-insensitive name match against the controller config — ids are not
hardcoded. A role whose circuit isn't found has its control **hidden**, not guessed.

## Command map

| Control | Action | Adapter call | Confirm? |
|---|---|---|---|
| Pool | on/off | `setCircuitState(poolId, bool)` | **on confirms** |
| Spa | on/off | `setCircuitState(spaId, bool)` | **on confirms** |
| Spillway | on/off | `setCircuitState(spillwayId, bool)` | **on confirms** |
| Pool/Spa setpoint | set °F | `setSetPoint(bodyIndex, tempF)` | **Apply confirms** |
| Pool Light | on/off | `setCircuitState(poolLightId, bool)` | instant |
| Spa Light | on/off | `setCircuitState(spaLightId, bool)` | instant |
| Yard Light — On now | on | `setCircuitState(yardId, true)` | instant |
| Yard Light — Extend | timed on | `setCircuitRuntime(yardId, minutes)` | instant |

- Turning a guarded body/feature **off** is instant; only **on** confirms (only "on"
  actuates/costs).
- Setpoint −/+ adjusts a pending value; **Apply** commits. Clamped to 40–104°F.

## Implementation risks to verify live (no fabrication)

Validated in the plan's live steps; if reality differs, the adapter/mapping adjusts in one place:

1. **`bodyIndex` for setpoint** — the `BodyIndex` enum value for Pool vs Spa must be
   confirmed against `EE-59-51` (bodies report ids 1/2; the setpoint enum may differ).
   Verify with a controlled read → set tiny offset → read-back before wiring the UI.
2. **Body "on" semantics** — confirm toggling the Pool/Spa circuit is the correct
   "turn the body on" action on this panel, via one controlled test.

## Error handling

- `sendCommand` rejects if the session isn't connected → UI shows "not connected,"
  reverts the optimistic flip, sends nothing.
- Adapter write throws (gateway reject/timeout) → `POST /api/command` returns failure →
  UI reverts the control + brief toast. A write failure **never** triggers a reconnect
  (`getEquipmentState` stays the sole connection-health signal).
- Reconcile is the backstop: the next poll shows ground truth, so the UI can't drift from
  reality more than one cycle.
- Commands validated server-side (known action, known role, setpoint in range) before
  touching the gateway — the browser is never trusted blindly.

## Testing

- **Adapter write wrappers** — not unit-tested (pure I/O); verified live against
  `EE-59-51` with controlled single commands (including the two risk checks above).
- **`gatewaySession.sendCommand`** — unit-tested with a fake adapter: forwards the write
  when connected; rejects when disconnected; a write rejection does not tear down the
  connection.
- **`server.js` `POST /api/command`** — unit-tested with `supertest` + a fake session:
  valid actions forward and return success; unknown action / out-of-range setpoint /
  unknown role → 400; disconnected → 503.
- **Circuit-role resolver** (name → id, case-insensitive, hidden when absent) — pure
  function, unit-tested.
- **Frontend** (hero tiles, inline confirm, optimistic + reconcile, glow, nav, relocated
  Schedules view) — verified live in the browser.
- **Live end-to-end:** actuate a safe circuit (a light) through the browser and confirm
  the poll reconciles; exercise an inline confirm; confirm the Schedules view still lists
  the three schedules.

## Known limitations

- **No authentication.** The app stays LAN-only; anyone on the network can now actuate
  equipment, not just view status. Same network exposure as the read-only app, higher
  stakes. Adding auth is out of scope here and noted for a future decision.

## Deferred — Spec 2 (next brainstorm)

Schedule management: add, edit (times/days/circuit), enable/disable, delete — with an
editor UX, validation (end-before-start, overlaps), and write-confirm flow.
