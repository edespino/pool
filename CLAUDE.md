# CLAUDE.md — Pentair Pool Dashboard

Guidance for working in this repo with Claude Code.

## What this is

A LAN-only Node.js web app that controls a **real** Pentair ScreenLogic pool system. Commands
actuate physical equipment (pump, gas heater, valves, lights). Treat writes with care and
verify them live; don't guess at protocol behavior.

## Architecture

- `src/slAdapter.js` — the **only** file that imports `node-screenlogic`. All protocol calls
  go through it; keep it thin so everything else is unit-testable with injected fakes.
- `src/discovery.js` — pure: pick the gateway from UDP responders, with a manual-IP fallback.
- `src/normalize.js` — pure: raw gateway payloads → clean objects (`normalizeStatus`,
  `normalizeSystemTime`, `normalizeSchedules`, `normalizePump`). **Derive honestly** — e.g.
  pump `running` from RPM (the `isRunning` flag false-positives), and gpm `255` (0xFF "no
  data" sentinel) → `null`. Never fabricate fields the gateway doesn't provide.
- `src/gatewaySession.js` — EventEmitter state machine: discover → connect → poll → reconnect
  (exponential backoff). Secondary fetches (system time, pump) are **best-effort** and must
  never trigger reconnect; `getEquipmentState` is the sole connection-health signal.
  `sendCommand(fn)` runs writes on the live connection.
- `src/server.js` — Express: static + `GET /status` + `GET /events` (SSE) +
  `POST /api/command`. Validate commands server-side; resolve circuit roles by name on the
  server; never trust the browser.
- `src/processGuards.js` — process-level `unhandledRejection` guard (node-screenlogic leaks an
  orphan rejection during teardown; this keeps the long-running server alive).
- `public/` — vanilla-JS frontend: SSE client, optimistic UI + reconcile, hamburger nav
  (Control / Schedules / Pumps / Details).

## Conventions

- Tests: `npm test` (Node's built-in `node:test`; `supertest` for HTTP). Follow TDD —
  failing test first.
- `slAdapter.js` and `public/` are intentionally **not** unit-tested; verify them live against
  the gateway (a temporary read-only probe script is the pattern — delete it after).
- Confirm protocol facts against the installed library's type defs or a live probe; do not
  invent method names, fields, or values.
- Don't commit `capture.*.json` (gitignored). Keep real home network details (LAN IPs, MAC,
  equipment serials) out of committed docs — use placeholders.
- Commits are attributed to the user; never modify git config.
- Apache-2.0 license header on source files.

## Domain facts

- Gateway is discovered via a **UDP broadcast on port 1444** (link-local — never leaves the
  LAN); control runs over a **persistent TCP connection** to the gateway.
- Equipment: see `docs/EQUIPMENT.md`. The pump is a variable-speed IntelliFlo with **no flow
  sensor**, so GPM is never reported (always the 0xFF sentinel).
- Heater is **gas**: heat mode `3` (HEATER) = enabled, `0` (OFF) = disabled.

## Deferred

- **Pump-speed adjustment** — read-only today; needs pool volume + a pool professional's
  input before writing pump RPMs.
- **Schedule management** — add/edit/delete (a future spec).
