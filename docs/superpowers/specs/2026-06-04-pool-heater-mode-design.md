# Pool Heater Mode Control — Design

**Date:** 2026-06-04
**Status:** Approved, pending implementation plan
**Builds on:** the interactive control panel (Spec 1)

## Summary

Add a heater enable/disable control to the **Pool** tile, plus a loud "actively heating"
indicator. The pool has a single **gas heater**; its `heatMode` can be enabled (heat
engages when the pool is running and below setpoint) or disabled (no heating). The current
app reads `heatStatus` but ignores `heatMode` and offers no control for it — this fills
that gap.

Confirmed live against `EE-59-51`: both bodies currently report `heatMode=0 (OFF)`.
`BodyIndex.POOL=0`. `HeatModes`: `OFF=0`, `HEATER=3`.

## Scope

**In scope:** Pool-only heater enable/disable (gas heater: enabled = `HEATER` mode 3,
disabled = `OFF` mode 0); a `heatEnabled` field in the status; a highly visible
"heating now" state on the Pool tile.

**Out of scope:** Spa heater control (the user only uses the pool heater); other heat
modes (solar, heat pump); changing heat behavior of any other body.

## Behavior

- **Heater control lives on the Pool tile only** (Spa tile unchanged).
- **Enabling confirms** (inline `✓ Enable heater / Cancel`), consistent with the other
  costly "on" actions. **Disabling is instant.**
- Optimistic update + reconcile, keyed `poolHeater`, reconciled against `pool.heatEnabled`
  (cleared when the gateway reflects the desired state or after 10s) — same machinery as
  the circuit toggles, reading `heatEnabled` instead of a circuit's `on`.

### Three Pool-tile states

| State | Condition | Look |
|---|---|---|
| Heater **off** | `heatEnabled = false` | Dim flame chip: `🔥 Heater off` |
| Heater **on, idle** | `heatEnabled = true`, `heaterOn = false` | Steady lit chip: `🔥 Heater on` |
| **HEATING now** | `heaterOn = true` (`heatStatus !== 0`) | Flickering 🔥 + pulsing **red** glow on the whole Pool tile + a `HEATING` label, overriding the normal blue pool glow |

The "heating now" state is display-only, driven by `heaterOn` (gateway `heatStatus`), which
is true only when the heater is actually firing. It updates each ~5s poll. No extra command.

## Architecture

Extends the existing read + write pipelines.

**Read (`src/normalize.js`):** the `body()` helper currently returns
`{ tempF, setpointF, heaterOn }`. Add **`heatEnabled: heatMode !== 0`**. Applies to both
pool and spa (cheap, consistent); only the Pool tile uses it.

**Write:**
- **`src/slAdapter.js`** — add `setHeatMode(conn, bodyIndex, mode)` →
  `conn.bodies.setHeatModeAsync(bodyIndex, mode)`. (Only file importing node-screenlogic.)
- **`src/server.js`** — `POST /api/command` gains action `heatmode`:
  `{ action:'heatmode', body:'pool', enabled:boolean }`. Validates `body` against the
  existing `BODY_INDEX` whitelist and that `enabled` is boolean; maps `enabled` → mode
  (`true → 3 HEATER`, `false → 0 OFF`); calls
  `session.sendCommand(conn => adapter.setHeatMode(conn, bodyIndex, mode))`. Same 400 /
  502 / 503 handling as the other actions.

**Frontend (`public/app.js`, `public/index.html`):**
- Pool tile renders the heater chip below the setpoint, reflecting the three states above.
- Enable → inline confirm (reuses the `confirming` set with key `poolHeater`); disable →
  instant. Both go through optimistic `pending` (key `poolHeater`) + the failure
  revert/toast path.
- `reconcile()` special-cases `poolHeater`: clears the override when
  `status.pool.heatEnabled === desired` or after 10s.
- CSS: a flame-flicker keyframe (opacity/scale wobble) on the icon and a red `box-shadow`
  pulse on the tile, applied when `heaterOn` is true (overrides `glow-pool`).
- POST payload `{action:'heatmode', body:'pool', enabled}`.

## Error handling

Same model as the other commands: server validates before any adapter call; a write
failure returns 502 (or 503 when disconnected) and the UI reverts the optimistic flip +
shows a toast; write failures never trigger a reconnect (`getEquipmentState` stays the
sole connection-health signal). Reconcile is the backstop — the UI can't drift past one
poll cycle.

## Testing

- **`normalize.js`** — unit test `heatEnabled = heatMode !== 0` (fixtures carry `heatMode`;
  add `heatMode:0 → false` and a non-zero → `true`). Existing body assertions stay green.
- **`slAdapter.setHeatMode`** — not unit-tested (pure I/O); verified live.
- **`server.js` action `heatmode`** — unit-tested with `supertest` + fake adapter:
  `{body:'pool', enabled:true}` → `setHeatMode(conn, 0, 3)`; `enabled:false` →
  `setHeatMode(conn, 0, 0)`; unknown body → 400; non-boolean `enabled` → 400;
  disconnected → 503.
- **Frontend** — verified live: enable the pool heater **with the pool off** (safe — gas
  won't fire unless the pool is running), confirm `pool.heatEnabled` flips true via
  `/status`, then disable and confirm it restores. The red-flicker "HEATING" state is
  driven by `heaterOn` from the gateway and shows whenever the heater actually fires.

## Known limitations

- Inherits the app's existing no-authentication, LAN-only posture (now including a heater
  enable, which has energy cost). Unchanged from prior specs; noted.
