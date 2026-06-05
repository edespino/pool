# Pentair Pool Controller — Design (v1)

**Date:** 2026-06-03
**Status:** Approved, pending implementation plan

## Summary

A local web app to monitor (and later control) a Pentair pool system. The system
is an EasyTouch/IntelliTouch controller fronted by a **ScreenLogic** gateway named
`EE-59-51`, currently operated via the "ScreenLogic Connect" mobile app on the LAN.

**v1 scope is read-only:** reliably *locate* the gateway on the network and display
*live status*. No control commands in v1 — this de-risks the protocol before we send
any state-changing commands. Control (toggles, setpoints, lights) is explicitly
deferred to later versions.

## Stack

- **Runtime:** Node.js
- **Protocol library:** [`node-screenlogic`](https://github.com/parnic/node-screenlogic)
  — handles UDP discovery and the persistent TCP session; we do not reverse-engineer
  the wire format.
- **Web layer:** Express, serving a static page plus a Server-Sent Events (SSE) stream.
- **Frontend:** single static HTML page + vanilla JS (read-only dashboard needs no framework).

## Architecture

Approach **A — stateful server + push**. The server holds a single persistent
connection to the gateway (ScreenLogic dislikes concurrent connections), polls
status on an interval, and pushes updates to browsers via SSE.

```
┌─────────────┐   UDP :1444 broadcast    ┌──────────────────┐
│  discovery  │ ───────────────────────► │ Pentair Gateway  │
│  (find IP)  │ ◄─────────────────────── │   "EE-59-51"     │
└─────────────┘   {ip, port, name, ...}  └──────────────────┘
       │                                          ▲
       ▼ {ip, port}                               │ TCP (persistent)
┌──────────────────┐   poll every N sec           │
│  gatewaySession  │ ─────────────────────────────┘
│ (connect + poll) │  emits 'status' events
└──────────────────┘
       │ status objects
       ▼
┌──────────────────┐   SSE /events     ┌─────────────┐
│   web server     │ ────────────────► │   browser   │
│ (Express + SSE)  │   GET /  (page)   │  (live UI)  │
└──────────────────┘                   └─────────────┘
```

### Modules (each independently testable)

- **`discovery.js`** — wraps `node-screenlogic` `FindUnits` UDP broadcast.
  Input: optional target name (`EE-59-51`) and optional manual IP. Output:
  `{ip, port, gatewayName, gatewayType}` or a timeout error. Filters responders
  for the configured gateway name; falls back to a configured manual IP on empty
  result.
- **`gatewaySession.js`** — owns the single persistent `UnitConnection`. Connects,
  logs in, polls status on an interval, normalizes the raw payload, and emits
  `status` / `error` / `reconnect` events. Hides all protocol detail.
- **`server.js`** — Express. Serves the static page and an SSE `/events` stream
  that forwards session updates. Holds last-known status to send immediately on
  new SSE connect.
- **`public/`** — single static HTML page + JS that opens the SSE stream and
  renders status.

## Discovery flow (first runnable milestone)

1. On startup, `discovery.js` runs `FindUnits.search()` — UDP broadcast to
   `255.255.255.255:1444`, collecting responders for `DISCOVERY_TIMEOUT_MS` (~5s).
2. Each responder yields `{address, port, gatewayName, gatewayType}`; `gatewayName`
   looks like `Pentair: EE-59-51`.
3. Filter for `EE-59-51` (lock onto this gateway even if multiple exist). On match,
   pass `{ip, port}` to the session.
4. **Manual-IP fallback:** if the broadcast finds nothing (different VLAN/subnet,
   Wi-Fi client isolation), fall back to `POOL_GATEWAY_IP` and connect directly.
5. Log which path succeeded:
   `Discovered EE-59-51 at 192.168.x.x:80 via broadcast` or `... via configured IP`.

**Milestone:** `npm run discover` prints what it found and exits — confirms
reachability before any further build. Directly satisfies "ensure we can locate it first."

## Normalized status object

Emitted by the session, rendered read-only by the browser. Derived from
`node-screenlogic`'s `getPoolStatus` / controller-config calls. Anything the
controller does not report (e.g. no salt cell) is omitted from the UI, not shown as zero.

```js
{
  gateway:  { name: "EE-59-51", ip, port, connected: true, lastUpdate: <ts> },
  air:      { tempF: 78 },
  pool:     { active: false, tempF: 65, heaterOn: false, setpointF: 84 },
  spa:      { active: true,  tempF: 102, heaterOn: true,  setpointF: 102 },
  circuits: [ { id, name: "Pool Light", state: true }, ... ],   // display only
  chemistry:{ ph: 7.4, orp: 700, saltPPM: 3200 },               // shown only if reported
  serviceMode: false
}
```

## Connection lifecycle / resilience

- `gatewaySession` is a small state machine:
  `discovering → connecting → connected → polling`, with `reconnecting` on failure
  (exponential backoff, capped ~30s).
- Gateway drops never crash the server — the UI shows a "disconnected" banner and
  the session retries.
- On reconnect, re-run discovery first (gateway IP may change via DHCP), then reconnect.
- SSE clients that drop are cleaned up; new clients immediately receive last-known
  status so the page is never blank on load.

## Config (env vars, defaults; no secrets in code)

| Var | Default | Purpose |
|-----|---------|---------|
| `POOL_GATEWAY_NAME` | `EE-59-51` | Which gateway to lock onto |
| `POOL_GATEWAY_IP` | (unset) | Manual fallback IP; backs up/skips broadcast |
| `POOL_GATEWAY_PORT` | `80` | Gateway TCP port |
| `POLL_INTERVAL_MS` | `5000` | Status poll cadence |
| `DISCOVERY_TIMEOUT_MS` | `5000` | UDP discovery window |
| `PORT` | `3000` | Web server port |

## Testing

- **Status normalizer** — unit-tested with captured fixture payloads (pure function,
  no network).
- **Discovery filtering** — unit-tested with the UDP socket mocked: picks `EE-59-51`
  out of multiple responders; falls back to configured IP on empty result.
- **Session state machine** — tested with a faked `UnitConnection` to verify
  reconnect/backoff transitions.
- **Web/SSE + real gateway I/O** — verified manually against the live `EE-59-51`,
  starting with the `npm run discover` milestone. Live integration is the proof,
  not mocked.

## Out of scope for v1 (deferred)

- Any control / state-changing commands (power, lights, heat setpoints, schedules,
  chemistry adjustment).
- Authentication / multi-user access.
- Native mobile or desktop packaging.
