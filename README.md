# Espino Pool — Pentair ScreenLogic Dashboard

A small, local web app to monitor and control a Pentair pool/spa system through its
**ScreenLogic** gateway, entirely on the local network. Node.js backend, vanilla-JS frontend,
no cloud.

## Features

- **Live status** over Server-Sent Events: pool/spa temperatures, heater state, circuits, air
  temperature, and chemistry (when an IntelliChem is present).
- **Interactive control**: toggle Pool / Spa / Spillway / lights, adjust heat setpoints, and
  enable/disable the gas heater. Actuating "on" actions use an inline confirm; the UI updates
  optimistically and reconciles on the next poll.
- **Schedules** view (read-only) with a "running now" indicator.
- **Pumps** view (read-only): variable-speed pump identity plus live RPM/Watts and the
  per-circuit speed presets.
- **Details** view: gateway connection + equipment inventory.
- **Resilient**: auto-reconnect with backoff; tolerates the gateway's quirks without crashing.

## How it works

A Node server discovers the gateway via a **UDP broadcast (port 1444)**, holds a single
**persistent TCP connection** to it, polls every few seconds, normalizes the data, and pushes
it to the browser over SSE. Write commands go through a small server-validated API
(`POST /api/command`). The browser is a thin client — all pool communication happens on the
server, which is the one process that talks to the gateway.

## Run it

```bash
npm install
npm start        # http://localhost:3000
npm test         # unit tests (Node's built-in test runner)
```

See **[docs/RUNNING.md](docs/RUNNING.md)** for always-on setup, networking (stable IP, Bonjour
name), and configuration, and **[docs/EQUIPMENT.md](docs/EQUIPMENT.md)** for the equipment
inventory. Design specs and implementation plans live under `docs/superpowers/`.

## Configuration

Environment variables (all optional): `PORT`, `POOL_GATEWAY_NAME`, `POOL_GATEWAY_IP`,
`POOL_GATEWAY_PORT`, `POOL_GATEWAY_PASSWORD`, `POLL_INTERVAL_MS`, `DISCOVERY_TIMEOUT_MS`,
`POOL_PUMP_ID`. Discovery is automatic; set `POOL_GATEWAY_IP` only if UDP broadcast can't
reach the gateway.

## Tech

Node.js (ESM), [`node-screenlogic`](https://github.com/parnic/node-screenlogic), Express +
SSE, vanilla HTML/JS, `node:test` + `supertest`.

## Scope

Control of circuits, heat setpoints, and the pool heater; read-only schedules and pumps.
Deferred: pump-speed adjustment and schedule editing. **LAN-only, no authentication** by
design (see RUNNING.md for hardening options).

## License

[Apache-2.0](LICENSE).
