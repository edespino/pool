# Pentair Pool Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Node.js web app that discovers a Pentair ScreenLogic gateway named `EE-59-51` on the LAN and displays its live status (read-only) in the browser.

**Architecture:** Approach A — a stateful Node server runs discovery once, holds a single persistent connection to the gateway via `node-screenlogic`, polls equipment state on an interval, normalizes it, and pushes updates to browsers over Server-Sent Events (SSE). All third-party protocol calls are isolated behind one adapter module so the rest of the code is unit-testable with injected fakes.

**Tech Stack:** Node.js (ESM, `"type": "module"`), `node-screenlogic` (protocol), Express (web), `supertest` (HTTP tests), Node's built-in `node:test` + `node:assert` test runner (no extra test framework), vanilla HTML/JS frontend.

---

## Spec Deviations (read before starting)

The confirmed `node-screenlogic` payloads do **not** cleanly expose two fields the
spec's example status object listed. To avoid fabricating protocol fields, v1 handles
them as follows:

- **`pool.active` / `spa.active`** — omitted from the v1 normalizer. The equipment
  state gives body temps/setpoints/heat, but "is this body currently running" is not a
  direct field. It is derivable from the matching named circuit's state; that derivation
  is deferred to the live-verification task (Task 8) once the real circuit naming on
  `EE-59-51` is observed, so we don't guess circuit names blindly.
- **`serviceMode`** — omitted from v1 (no confirmed field in the equipment-state payload).

Everything else in the spec is implemented as written.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `package.json` | Deps, scripts, ESM flag |
| `src/config.js` | Parse env vars → typed config object with defaults |
| `src/slAdapter.js` | **Only** file that imports `node-screenlogic`. Wraps discovery + connection. Not unit-tested; exercised live. |
| `src/discovery.js` | Pure logic: filter responders for `EE-59-51`, manual-IP fallback. Takes an injected `findUnits` fn. |
| `src/normalize.js` | Pure function: `(controllerConfig, equipmentState) → status object`. |
| `src/gatewaySession.js` | `EventEmitter` state machine: discover → connect → poll → reconnect (backoff). Deps injected. |
| `src/server.js` | `createServer(session)` → Express app: `GET /`, `GET /events` (SSE), last-known cache. |
| `src/index.js` | Entry point: wire config + real adapter + session + server, start listening. |
| `bin/discover.js` | `npm run discover` milestone — print what was found, exit. |
| `bin/capture.js` | `npm run capture` — dump raw controller config + equipment state to fixture files for inspection. |
| `public/index.html` | Dashboard markup. |
| `public/app.js` | Opens SSE stream, renders status, shows disconnected banner. |
| `test/*.test.js` | Unit tests per module. |
| `test/fixtures/*.json` | Sample payloads for normalizer tests. |

---

### Task 1: Project scaffold + config module

**Files:**
- Create: `package.json`
- Create: `src/config.js`
- Test: `test/config.test.js`
- Create: `.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
*.log
.DS_Store
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "pentair-pool-controller",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "discover": "node bin/discover.js",
    "capture": "node bin/capture.js",
    "test": "node --test"
  },
  "dependencies": {
    "express": "^4.19.2",
    "node-screenlogic": "^2.0.0"
  },
  "devDependencies": {
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 3: Install dependencies**

Run: `cd ~/workspace/pool && npm install`
Expected: `node_modules/` created, no errors. (Confirms `node-screenlogic` and `express` resolve.)

- [ ] **Step 4: Write the failing test**

`test/config.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('loadConfig applies defaults when env is empty', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.gatewayName, 'EE-59-51');
  assert.equal(cfg.gatewayIp, null);
  assert.equal(cfg.gatewayPort, 80);
  assert.equal(cfg.gatewayPassword, '');
  assert.equal(cfg.pollIntervalMs, 5000);
  assert.equal(cfg.discoveryTimeoutMs, 5000);
  assert.equal(cfg.webPort, 3000);
});

test('loadConfig reads overrides and coerces numbers', () => {
  const cfg = loadConfig({
    POOL_GATEWAY_NAME: 'AB-12-34',
    POOL_GATEWAY_IP: '192.168.1.50',
    POOL_GATEWAY_PORT: '6680',
    POOL_GATEWAY_PASSWORD: 'secret',
    POLL_INTERVAL_MS: '2000',
    DISCOVERY_TIMEOUT_MS: '3000',
    PORT: '8080',
  });
  assert.equal(cfg.gatewayName, 'AB-12-34');
  assert.equal(cfg.gatewayIp, '192.168.1.50');
  assert.equal(cfg.gatewayPort, 6680);
  assert.equal(cfg.pollIntervalMs, 2000);
  assert.equal(cfg.webPort, 8080);
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/config.js'`.

- [ ] **Step 6: Write minimal implementation**

`src/config.js`:
```javascript
function num(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env = process.env) {
  return {
    gatewayName: env.POOL_GATEWAY_NAME || 'EE-59-51',
    gatewayIp: env.POOL_GATEWAY_IP || null,
    gatewayPort: num(env.POOL_GATEWAY_PORT, 80),
    gatewayPassword: env.POOL_GATEWAY_PASSWORD || '',
    pollIntervalMs: num(env.POLL_INTERVAL_MS, 5000),
    discoveryTimeoutMs: num(env.DISCOVERY_TIMEOUT_MS, 5000),
    webPort: num(env.PORT, 3000),
  };
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test`
Expected: PASS (both config tests).

- [ ] **Step 8: Commit**

```bash
git add .gitignore package.json package-lock.json src/config.js test/config.test.js
git commit -m "feat: project scaffold and config module"
```

---

### Task 2: Discovery module (pure logic) + discover CLI

The discovery logic does not open sockets itself — it takes an injected `findUnits`
function (the real one lives in the adapter, Task 5b). This makes it fully unit-testable.

**Files:**
- Create: `src/discovery.js`
- Test: `test/discovery.test.js`

- [ ] **Step 1: Write the failing test**

`test/discovery.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverGateway } from '../src/discovery.js';

const cfg = { gatewayName: 'EE-59-51', gatewayIp: null, gatewayPort: 80, discoveryTimeoutMs: 5000 };

test('locks onto the named gateway among multiple responders', async () => {
  const findUnits = async () => [
    { address: '192.168.1.10', port: 80, gatewayName: 'Pentair: AA-00-00' },
    { address: '192.168.1.20', port: 80, gatewayName: 'Pentair: EE-59-51' },
  ];
  const result = await discoverGateway(cfg, findUnits);
  assert.deepEqual(result, {
    ip: '192.168.1.20', port: 80, name: 'EE-59-51', via: 'broadcast',
  });
});

test('falls back to configured IP when broadcast finds nothing', async () => {
  const findUnits = async () => [];
  const result = await discoverGateway(
    { ...cfg, gatewayIp: '192.168.1.99', gatewayPort: 6680 },
    findUnits,
  );
  assert.deepEqual(result, {
    ip: '192.168.1.99', port: 6680, name: 'EE-59-51', via: 'configured-ip',
  });
});

test('throws when broadcast finds nothing and no fallback IP is set', async () => {
  const findUnits = async () => [];
  await assert.rejects(() => discoverGateway(cfg, findUnits), /could not locate/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/discovery.test.js`
Expected: FAIL — `Cannot find module '../src/discovery.js'`.

- [ ] **Step 3: Write minimal implementation**

`src/discovery.js`:
```javascript
export async function discoverGateway(config, findUnits) {
  const units = await findUnits(config.discoveryTimeoutMs);
  const match = units.find(
    (u) => typeof u.gatewayName === 'string' && u.gatewayName.includes(config.gatewayName),
  );
  if (match) {
    return { ip: match.address, port: match.port, name: config.gatewayName, via: 'broadcast' };
  }
  if (config.gatewayIp) {
    return {
      ip: config.gatewayIp,
      port: config.gatewayPort,
      name: config.gatewayName,
      via: 'configured-ip',
    };
  }
  throw new Error(
    `Could not locate gateway "${config.gatewayName}" via broadcast and no POOL_GATEWAY_IP is set`,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/discovery.test.js`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add src/discovery.js test/discovery.test.js
git commit -m "feat: gateway discovery logic with manual-IP fallback"
```

---

### Task 3: ScreenLogic adapter (the only file touching node-screenlogic)

This wraps the library so its singleton/async quirks live in one place. It is **not**
unit-tested (it is pure I/O against the real library); it is exercised by the discover
CLI (Task 4) and live verification (Task 8). Keeping it thin is the point.

**Files:**
- Create: `src/slAdapter.js`

- [ ] **Step 1: Write the adapter**

`src/slAdapter.js`:
```javascript
import { FindUnits, screenlogic } from 'node-screenlogic';

// UDP broadcast discovery. Returns the raw LocalUnit array.
export async function findUnits(timeoutMs = 5000) {
  const finder = new FindUnits();
  try {
    return await finder.searchAsync(timeoutMs);
  } finally {
    finder.close();
  }
}

// Open a persistent connection and register for the equipment-state push channel.
// Returns the connected screenlogic singleton (the active connection handle).
export async function connect({ name, ip, port, password = '' }) {
  const systemName = name.startsWith('Pentair:') ? name : `Pentair: ${name}`;
  screenlogic.init(systemName, ip, port, password);
  await screenlogic.connectAsync();
  await screenlogic.addClientAsync();
  return screenlogic;
}

export function getControllerConfig(conn) {
  return conn.equipment.getControllerConfigAsync();
}

export function getEquipmentState(conn) {
  return conn.equipment.getEquipmentStateAsync();
}

export async function close(conn) {
  try {
    await conn.closeAsync();
  } catch {
    // already closed / never opened — ignore on teardown
  }
}
```

> **Note for implementer:** if `npm install` pulled a `node-screenlogic` whose exports
> differ (e.g. a `default` export, or `init/connectAsync` not on a `screenlogic`
> singleton), this is the ONLY file to adjust. Verify by running
> `node -e "import('node-screenlogic').then(m => console.log(Object.keys(m)))"`
> and align the imports above. Do not change other modules.

- [ ] **Step 2: Verify the library exports match**

Run: `node -e "import('node-screenlogic').then(m => console.log(Object.keys(m)))"`
Expected: output includes `FindUnits` and `screenlogic`. If not, adjust `src/slAdapter.js` imports to match the actual exports, then continue.

- [ ] **Step 3: Commit**

```bash
git add src/slAdapter.js
git commit -m "feat: node-screenlogic adapter (discovery + connection)"
```

---

### Task 4: `npm run discover` milestone (first runnable proof)

This satisfies "ensure we can locate it first." It runs real discovery and prints the
result. This is the first time we touch the actual gateway.

**Files:**
- Create: `bin/discover.js`

- [ ] **Step 1: Write the discover CLI**

`bin/discover.js`:
```javascript
import { loadConfig } from '../src/config.js';
import { discoverGateway } from '../src/discovery.js';
import { findUnits } from '../src/slAdapter.js';

const config = loadConfig();
console.log(`Searching for "${config.gatewayName}" (timeout ${config.discoveryTimeoutMs}ms)...`);

try {
  const gw = await discoverGateway(config, findUnits);
  console.log(`Discovered ${gw.name} at ${gw.ip}:${gw.port} via ${gw.via}`);
  process.exit(0);
} catch (err) {
  console.error(`Discovery failed: ${err.message}`);
  console.error('Tip: set POOL_GATEWAY_IP=<gateway ip> to use the manual fallback.');
  process.exit(1);
}
```

- [ ] **Step 2: Run discovery against the real gateway (LIVE)**

Run: `npm run discover`
Expected (broadcast reachable): `Discovered EE-59-51 at 192.168.x.x:80 via broadcast`.
If it fails with "could not locate", find the gateway IP (check router DHCP leases /
the ScreenLogic Connect app's system info) and run:
`POOL_GATEWAY_IP=192.168.x.x npm run discover`
Expected: `Discovered EE-59-51 at 192.168.x.x:<port> via configured-ip`.

> **Checkpoint:** Do not proceed past this task until discovery prints a real address.
> This confirms reachability and the adapter's discovery path before building anything
> on top of it. Record the working IP/port (and whether broadcast worked) for later tasks.

- [ ] **Step 3: Commit**

```bash
git add bin/discover.js
git commit -m "feat: discover CLI milestone"
```

---

### Task 5: Status normalizer (pure function)

Joins controller config (circuit names) with equipment state (live values) into the
clean status object. Tested against a representative fixture using the confirmed
`node-screenlogic` field names.

**Files:**
- Create: `test/fixtures/controllerConfig.json`
- Create: `test/fixtures/equipmentState.json`
- Create: `src/normalize.js`
- Test: `test/normalize.test.js`

- [ ] **Step 1: Create the fixture files**

`test/fixtures/controllerConfig.json`:
```json
{
  "circuitArray": [
    { "circuitId": 500, "name": "Pool", "function": 2, "deviceId": 6 },
    { "circuitId": 501, "name": "Spa", "function": 1, "deviceId": 1 },
    { "circuitId": 502, "name": "Pool Light", "function": 16, "deviceId": 7 }
  ]
}
```

`test/fixtures/equipmentState.json`:
```json
{
  "airTemp": 78,
  "bodies": [
    { "id": 0, "currentTemp": 65, "setPoint": 84, "heatStatus": 0, "heatMode": 0 },
    { "id": 1, "currentTemp": 102, "setPoint": 102, "heatStatus": 1, "heatMode": 1 }
  ],
  "circuitArray": [
    { "id": 500, "state": 0 },
    { "id": 501, "state": 1 },
    { "id": 502, "state": 1 }
  ],
  "pH": 7.4,
  "orp": 700,
  "saltPPM": 3200
}
```

- [ ] **Step 2: Write the failing test**

`test/normalize.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeStatus } from '../src/normalize.js';

const config = JSON.parse(readFileSync(new URL('./fixtures/controllerConfig.json', import.meta.url)));
const state = JSON.parse(readFileSync(new URL('./fixtures/equipmentState.json', import.meta.url)));

test('maps air temperature', () => {
  const s = normalizeStatus(config, state);
  assert.equal(s.air.tempF, 78);
});

test('maps pool (body 0) and spa (body 1) with heater status', () => {
  const s = normalizeStatus(config, state);
  assert.deepEqual(s.pool, { tempF: 65, setpointF: 84, heaterOn: false });
  assert.deepEqual(s.spa, { tempF: 102, setpointF: 102, heaterOn: true });
});

test('joins circuit names from config with live state as booleans', () => {
  const s = normalizeStatus(config, state);
  assert.deepEqual(s.circuits, [
    { id: 500, name: 'Pool', on: false },
    { id: 501, name: 'Spa', on: true },
    { id: 502, name: 'Pool Light', on: true },
  ]);
});

test('includes chemistry when pH is reported', () => {
  const s = normalizeStatus(config, state);
  assert.deepEqual(s.chemistry, { ph: 7.4, orp: 700, saltPPM: 3200 });
});

test('omits chemistry when pH is zero (no chem controller)', () => {
  const s = normalizeStatus(config, { ...state, pH: 0 });
  assert.equal(s.chemistry, undefined);
});

test('omits a body that is not present', () => {
  const s = normalizeStatus(config, { ...state, bodies: [state.bodies[0]] });
  assert.ok(s.pool);
  assert.equal(s.spa, undefined);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/normalize.test.js`
Expected: FAIL — `Cannot find module '../src/normalize.js'`.

- [ ] **Step 4: Write minimal implementation**

`src/normalize.js`:
```javascript
const BODY_LABELS = { 0: 'pool', 1: 'spa' }; // ScreenLogic body-index convention

function body(state, id) {
  const b = state.bodies?.find((x) => x.id === id);
  if (!b) return undefined;
  return { tempF: b.currentTemp, setpointF: b.setPoint, heaterOn: b.heatStatus !== 0 };
}

export function normalizeStatus(controllerConfig, equipmentState) {
  const names = new Map(
    (controllerConfig.circuitArray ?? []).map((c) => [c.circuitId, c.name]),
  );

  const status = {
    air: { tempF: equipmentState.airTemp },
    circuits: (equipmentState.circuitArray ?? []).map((c) => ({
      id: c.id,
      name: names.get(c.id) ?? `Circuit ${c.id}`,
      on: c.state !== 0,
    })),
  };

  for (const [id, label] of Object.entries(BODY_LABELS)) {
    const b = body(equipmentState, Number(id));
    if (b) status[label] = b;
  }

  if (equipmentState.pH > 0) {
    status.chemistry = {
      ph: equipmentState.pH,
      orp: equipmentState.orp,
      saltPPM: equipmentState.saltPPM,
    };
  }

  return status;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/normalize.test.js`
Expected: PASS (all six tests).

- [ ] **Step 6: Commit**

```bash
git add src/normalize.js test/normalize.test.js test/fixtures/
git commit -m "feat: status normalizer joining config and equipment state"
```

---

### Task 6: Gateway session (state machine + polling + reconnect)

An `EventEmitter` that owns the connection lifecycle. All dependencies (discover,
adapter, normalize, timers) are injected so the state machine is testable with fakes
and fast backoff values.

**Files:**
- Create: `src/gatewaySession.js`
- Test: `test/gatewaySession.test.js`

- [ ] **Step 1: Write the failing test**

`test/gatewaySession.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createSession } from '../src/gatewaySession.js';

function deps(overrides = {}) {
  const calls = { connects: 0 };
  return {
    config: { pollIntervalMs: 5, baseDelayMs: 1, maxDelayMs: 8 },
    discover: async () => ({ ip: '1.2.3.4', port: 80, name: 'EE-59-51', via: 'broadcast' }),
    adapter: {
      connect: async () => { calls.connects += 1; return { id: 'conn' }; },
      getControllerConfig: async () => ({ circuitArray: [{ circuitId: 500, name: 'Pool' }] }),
      getEquipmentState: async () => ({ airTemp: 80, bodies: [], circuitArray: [{ id: 500, state: 1 }], pH: 0 }),
      close: async () => {},
    },
    calls,
    ...overrides,
  };
}

test('emits a normalized status after connecting', async () => {
  const d = deps();
  const session = createSession(d);
  const [status] = await once(session, 'status');
  assert.equal(status.air.tempF, 80);
  assert.equal(status.gateway.connected, true);
  assert.equal(status.gateway.name, 'EE-59-51');
  assert.deepEqual(status.circuits, [{ id: 500, name: 'Pool', on: true }]);
  session.stop();
});

test('reconnects after a connect failure and eventually emits status', async () => {
  const d = deps();
  let fail = 2;
  d.adapter.connect = async () => {
    if (fail-- > 0) throw new Error('connection refused');
    return { id: 'conn' };
  };
  const session = createSession(d);
  const [status] = await once(session, 'status');
  assert.equal(status.air.tempF, 80);
  session.stop();
});

test('stop() halts polling and emits no further status', async () => {
  const d = deps();
  const session = createSession(d);
  await once(session, 'status');
  session.stop();
  let fired = false;
  session.on('status', () => { fired = true; });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fired, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/gatewaySession.test.js`
Expected: FAIL — `Cannot find module '../src/gatewaySession.js'`.

- [ ] **Step 3: Write minimal implementation**

`src/gatewaySession.js`:
```javascript
import { EventEmitter } from 'node:events';
import { normalizeStatus } from './normalize.js';

export function createSession({ config, discover, adapter }) {
  const emitter = new EventEmitter();
  const baseDelayMs = config.baseDelayMs ?? 1000;
  const maxDelayMs = config.maxDelayMs ?? 30000;

  let stopped = false;
  let pollTimer = null;
  let retryTimer = null;
  let conn = null;
  let gateway = null;
  let controllerConfig = null;

  function backoff(attempt) {
    return Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  }

  async function pollOnce() {
    const state = await adapter.getEquipmentState(conn);
    const status = normalizeStatus(controllerConfig, state);
    status.gateway = {
      name: gateway.name, ip: gateway.ip, port: gateway.port,
      connected: true, lastUpdate: Date.now(),
    };
    emitter.emit('status', status);
  }

  function scheduleNextPoll() {
    if (stopped) return;
    pollTimer = setTimeout(async () => {
      try {
        await pollOnce();
        scheduleNextPoll();
      } catch (err) {
        emitter.emit('error', err);
        teardownConn();
        startConnectLoop(); // lost the connection mid-poll → reconnect
      }
    }, config.pollIntervalMs);
  }

  function teardownConn() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (conn) { adapter.close(conn).catch(() => {}); conn = null; }
  }

  async function connectAttempt(attempt) {
    if (stopped) return;
    try {
      gateway = await discover(config);
      conn = await adapter.connect({
        name: gateway.name, ip: gateway.ip, port: gateway.port,
        password: config.gatewayPassword,
      });
      controllerConfig = await adapter.getControllerConfig(conn);
      emitter.emit('connected', gateway);
      await pollOnce();
      scheduleNextPoll();
    } catch (err) {
      emitter.emit('error', err);
      teardownConn();
      if (stopped) return;
      emitter.emit('reconnect', { attempt: attempt + 1 });
      retryTimer = setTimeout(() => connectAttempt(attempt + 1), backoff(attempt));
    }
  }

  function startConnectLoop() {
    if (!stopped) connectAttempt(0);
  }

  function stop() {
    stopped = true;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    teardownConn();
  }

  emitter.stop = stop;
  startConnectLoop();
  return emitter;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/gatewaySession.test.js`
Expected: PASS (all three tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — config, discovery, normalize, gatewaySession suites all green.

- [ ] **Step 6: Commit**

```bash
git add src/gatewaySession.js test/gatewaySession.test.js
git commit -m "feat: gateway session state machine with polling and reconnect"
```

---

### Task 7: Express server + SSE stream

`createServer(session)` returns an Express app. It subscribes to the session, caches
last-known status, serves the static page, and streams updates over SSE. New SSE
clients get the cached status immediately.

**Files:**
- Create: `src/server.js`
- Test: `test/server.test.js`

- [ ] **Step 1: Write the failing test**

`test/server.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import request from 'supertest';
import { createServer } from '../src/server.js';

test('GET / serves the dashboard HTML', async () => {
  const app = createServer(new EventEmitter());
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /html/);
  assert.match(res.text, /EE-59-51|Pool/i);
});

test('GET /status returns 503 before any status, then the cached status', async () => {
  const session = new EventEmitter();
  const app = createServer(session);

  const before = await request(app).get('/status');
  assert.equal(before.status, 503);

  session.emit('status', { air: { tempF: 81 }, circuits: [], gateway: { connected: true } });
  const after = await request(app).get('/status');
  assert.equal(after.status, 200);
  assert.equal(after.body.air.tempF, 81);
});

test('GET /events opens an SSE stream and sends cached status on connect', async () => {
  const session = new EventEmitter();
  const app = createServer(session);
  session.emit('status', { air: { tempF: 77 }, circuits: [], gateway: { connected: true } });

  const res = await request(app)
    .get('/events')
    .buffer(true)
    .parse((r, cb) => {
      let data = '';
      r.on('data', (chunk) => {
        data += chunk;
        if (data.includes('77')) { r.destroy(); cb(null, data); }
      });
      r.on('close', () => cb(null, data));
    });

  assert.match(res.headers['content-type'], /event-stream/);
  assert.match(res.text, /data: .*77/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/server.test.js`
Expected: FAIL — `Cannot find module '../src/server.js'`.

- [ ] **Step 3: Write minimal implementation**

`src/server.js`:
```javascript
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createServer(session) {
  const app = express();
  let lastStatus = null;
  const clients = new Set();

  session.on('status', (status) => {
    lastStatus = status;
    const payload = `data: ${JSON.stringify(status)}\n\n`;
    for (const res of clients) res.write(payload);
  });

  app.get('/status', (req, res) => {
    if (!lastStatus) return res.status(503).json({ error: 'no status yet' });
    res.json(lastStatus);
  });

  app.get('/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    clients.add(res);
    if (lastStatus) res.write(`data: ${JSON.stringify(lastStatus)}\n\n`);
    req.on('close', () => clients.delete(res));
  });

  app.use(express.static(publicDir));
  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/server.test.js`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add src/server.js test/server.test.js
git commit -m "feat: express server with SSE status stream"
```

---

### Task 8: Frontend, entry wiring, capture script, live verification

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`
- Create: `src/index.js`
- Create: `bin/capture.js`

- [ ] **Step 1: Create the dashboard markup**

`public/index.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pool — EE-59-51</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #0f1720; color: #e6edf3; }
    header { padding: 1rem; background: #15202b; display: flex; justify-content: space-between; align-items: center; }
    #banner { display: none; background: #7a1f1f; color: #fff; padding: .5rem 1rem; text-align: center; }
    #banner.show { display: block; }
    main { padding: 1rem; display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
    .card { background: #15202b; border-radius: 10px; padding: 1rem; }
    .card h2 { margin: 0 0 .5rem; font-size: .9rem; text-transform: uppercase; color: #8b98a5; }
    .big { font-size: 2rem; font-weight: 600; }
    .on { color: #3fb950; } .off { color: #6e7681; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { display: flex; justify-content: space-between; padding: .25rem 0; }
  </style>
</head>
<body>
  <header><strong>Pool — EE-59-51</strong><span id="updated">—</span></header>
  <div id="banner">Disconnected — retrying…</div>
  <main id="cards"></main>
  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create the client script**

`public/app.js`:
```javascript
const cards = document.getElementById('cards');
const banner = document.getElementById('banner');
const updated = document.getElementById('updated');

function tempCard(title, t) {
  if (!t) return '';
  const heat = t.heaterOn ? '<span class="on">heating</span>' : '<span class="off">idle</span>';
  return `<div class="card"><h2>${title}</h2>
    <div class="big">${t.tempF}&deg;</div>
    <div>set ${t.setpointF}&deg; · ${heat}</div></div>`;
}

function render(s) {
  const parts = [];
  if (s.air) parts.push(`<div class="card"><h2>Air</h2><div class="big">${s.air.tempF}&deg;</div></div>`);
  parts.push(tempCard('Pool', s.pool));
  parts.push(tempCard('Spa', s.spa));
  if (s.circuits?.length) {
    const items = s.circuits.map((c) =>
      `<li><span>${c.name}</span><span class="${c.on ? 'on' : 'off'}">${c.on ? 'ON' : 'off'}</span></li>`).join('');
    parts.push(`<div class="card"><h2>Circuits</h2><ul>${items}</ul></div>`);
  }
  if (s.chemistry) {
    parts.push(`<div class="card"><h2>Chemistry</h2>
      <div>pH ${s.chemistry.ph}</div><div>ORP ${s.chemistry.orp}</div>
      <div>Salt ${s.chemistry.saltPPM} ppm</div></div>`);
  }
  cards.innerHTML = parts.join('');
  if (s.gateway?.lastUpdate) updated.textContent = new Date(s.gateway.lastUpdate).toLocaleTimeString();
}

function connect() {
  const es = new EventSource('/events');
  es.onmessage = (e) => { banner.classList.remove('show'); render(JSON.parse(e.data)); };
  es.onerror = () => { banner.classList.add('show'); };
}
connect();
```

- [ ] **Step 3: Create the entry point**

`src/index.js`:
```javascript
import { loadConfig } from './config.js';
import { discoverGateway } from './discovery.js';
import * as adapter from './slAdapter.js';
import { createSession } from './gatewaySession.js';
import { createServer } from './server.js';

const config = { ...loadConfig(), baseDelayMs: 1000, maxDelayMs: 30000 };
const discover = (cfg) => discoverGateway(cfg, adapter.findUnits);
const session = createSession({ config, discover, adapter });

session.on('connected', (gw) => console.log(`Connected to ${gw.name} at ${gw.ip}:${gw.port} via ${gw.via}`));
session.on('reconnect', ({ attempt }) => console.log(`Reconnecting (attempt ${attempt})...`));
session.on('error', (err) => console.error(`Session error: ${err.message}`));

const app = createServer(session);
app.listen(config.webPort, () => console.log(`Pool dashboard on http://localhost:${config.webPort}`));
```

- [ ] **Step 4: Create the capture script**

`bin/capture.js`:
```javascript
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { discoverGateway } from '../src/discovery.js';
import * as adapter from '../src/slAdapter.js';

const config = loadConfig();
const gw = await discoverGateway(config, adapter.findUnits);
console.log(`Connecting to ${gw.name} at ${gw.ip}:${gw.port}...`);
const conn = await adapter.connect({ name: gw.name, ip: gw.ip, port: gw.port, password: config.gatewayPassword });

const controllerConfig = await adapter.getControllerConfig(conn);
const equipmentState = await adapter.getEquipmentState(conn);
writeFileSync('capture.controllerConfig.json', JSON.stringify(controllerConfig, null, 2));
writeFileSync('capture.equipmentState.json', JSON.stringify(equipmentState, null, 2));
await adapter.close(conn);
console.log('Wrote capture.controllerConfig.json and capture.equipmentState.json');
process.exit(0);
```

- [ ] **Step 5: Capture real payloads (LIVE) and sanity-check the normalizer**

Run: `npm run capture` (use `POOL_GATEWAY_IP=...` prefix if broadcast was unreliable in Task 4).
Expected: two JSON files written. Open `capture.equipmentState.json` and confirm the
field names match the fixtures (`airTemp`, `bodies[].currentTemp/setPoint/heatStatus`,
`circuitArray[].id/state`, `pH/orp/saltPPM`) and that body `id` 0/1 correspond to
pool/spa. If real field names differ, update `src/normalize.js` and the fixtures, then
re-run `node --test test/normalize.test.js`.

> Add `capture.*.json` to `.gitignore` (live data, not committed):
> append `capture.*.json` to `.gitignore`.

- [ ] **Step 6: Run the app and verify in the browser (LIVE)**

Run: `npm start` (with `POOL_GATEWAY_IP=...` if needed).
Expected: console prints `Connected to EE-59-51 ...` then `Pool dashboard on http://localhost:3000`.
Open `http://localhost:3000` in a browser. Confirm: air/pool/spa temps, circuit
on/off list, and (if present) chemistry render and update roughly every 5 seconds.
Toggle a light from the ScreenLogic Connect app and confirm the dashboard reflects it
within a poll cycle. Pull power/network briefly and confirm the red "Disconnected"
banner appears, then clears on recovery.

- [ ] **Step 7: Commit**

```bash
git add public/ src/index.js bin/capture.js .gitignore
git commit -m "feat: dashboard frontend, app entry point, and capture script"
```

---

## Verification Checklist (run before declaring done)

- [ ] `npm test` — all suites pass (config, discovery, normalize, gatewaySession, server).
- [ ] `npm run discover` prints a real gateway address.
- [ ] `npm start` connects and serves a live-updating dashboard at `http://localhost:3000`.
- [ ] Disconnect/reconnect shows and clears the banner without crashing the server.
- [ ] No control/state-changing calls exist anywhere (v1 is read-only).
