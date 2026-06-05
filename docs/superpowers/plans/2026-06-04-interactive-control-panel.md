# Interactive Control Panel Implementation Plan (Spec 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the read-only dashboard into an interactive control panel — toggle Pool/Spa/Spillway/lights, adjust heat setpoints, extend the yard light — with a navigation shell (Control + Schedules views), inline confirm on guarded actions, and optimistic UI that reconciles via the existing status poll.

**Architecture:** A write path is added alongside the read-only pipeline: the browser POSTs commands to `server.js`, which calls `gatewaySession.sendCommand(fn)` running an adapter write on the single persistent connection; the next 5s status poll reflects truth over SSE. The frontend updates optimistically and reconciles on the next poll.

**Tech Stack:** Node.js (ESM), node-screenlogic 2.1.1, Express + SSE, vanilla JS frontend, Node `node:test` + `supertest`.

**Spec:** `docs/superpowers/specs/2026-06-04-interactive-control-panel-design.md`

**Confirmed library facts (verified against installed type defs):**
- `conn.circuits.setCircuitStateAsync(circuitId, bool)` and `conn.circuits.setCircuitRuntimebyIdAsync(circuitId, runTime)`
- `conn.bodies.setSetPointAsync(bodyIndex, temperature)` — `BodyIndex` enum: `POOL=0`, `SPA=1`
- Reads remain on `conn.equipment` (unchanged)

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/slAdapter.js` | modify | Add write wrappers: `setCircuitState`, `setSetPoint`, `setCircuitRuntime` |
| `src/circuitRoles.js` | create | Pure resolver: role name → circuit id from the status circuit list |
| `src/gatewaySession.js` | modify | Add `sendCommand(fn)` — run an adapter write on the live connection |
| `src/server.js` | modify | Add `POST /api/command` (validate + dispatch); accept injected adapter |
| `src/index.js` | modify | Pass `adapter` into `createServer` |
| `public/index.html` | modify | Nav tabs + two view containers + control-panel styles |
| `public/app.js` | modify | View switching, control-panel render, commands, optimistic+reconcile |
| `test/circuitRoles.test.js` | create | Resolver unit tests |
| `test/gatewaySession.test.js` | modify | `sendCommand` tests |
| `test/server.test.js` | modify | `POST /api/command` tests |

---

### Task 1: Adapter write wrappers

`src/slAdapter.js` is the only file importing node-screenlogic. Add three write wrappers. Not unit-tested (pure I/O) — verified live in Task 2.

**Files:** Modify: `src/slAdapter.js`

- [ ] **Step 1: Add the wrappers** after the existing `getSchedules` function (before `close`):

```javascript
export function setCircuitState(conn, circuitId, on) {
  return conn.circuits.setCircuitStateAsync(circuitId, on);
}

export function setSetPoint(conn, bodyIndex, temperatureF) {
  return conn.bodies.setSetPointAsync(bodyIndex, temperatureF);
}

// runtimeMinutes: one-time "egg timer" duration; circuit auto-offs after it elapses.
export function setCircuitRuntime(conn, circuitId, runtimeMinutes) {
  return conn.circuits.setCircuitRuntimebyIdAsync(circuitId, runtimeMinutes);
}
```

- [ ] **Step 2: Verify the module loads and exports the new names**

Run: `node -e "import('./src/slAdapter.js').then(m => console.log(Object.keys(m).sort()))"`
Expected: includes `setCircuitRuntime`, `setCircuitState`, `setSetPoint` alongside the existing exports. No live connection.

- [ ] **Step 3: Commit**

```bash
git add src/slAdapter.js
git commit -m "feat: adapter write wrappers (circuit state, setpoint, runtime)"
```

---

### Task 2: Live safety probe — confirm writes work and bodyIndex mapping

Before building on writes, confirm them against `EE-59-51` with a **safe, reversible** probe. This validates `setCircuitState` end-to-end and that `BodyIndex.POOL=0` actually targets the pool's setpoint. The probe restores everything it changes.

**Files:** none committed (temporary probe script, removed after).

- [ ] **Step 1: Write a temporary probe** at `probe-writes.mjs` (project root):

```javascript
import { loadConfig } from './src/config.js';
import { discoverGateway } from './src/discovery.js';
import * as adapter from './src/slAdapter.js';

const config = loadConfig();
const gw = await discoverGateway(config, adapter.findUnits);
const conn = await adapter.connect({ name: gw.name, ip: gw.ip, port: gw.port, password: config.gatewayPassword });

// Find the Spa Light circuit id from controller config (safe to toggle).
const cfg = await adapter.getControllerConfig(conn);
const spaLight = cfg.circuitArray.find((c) => /^spa light$/i.test(c.name));
console.log('Spa Light circuit:', spaLight && spaLight.circuitId);

// 1) Circuit write round-trip on the Spa Light (toggle, read, restore).
let st = await adapter.getEquipmentState(conn);
const before = st.circuitArray.find((c) => c.id === spaLight.circuitId).state;
await adapter.setCircuitState(conn, spaLight.circuitId, before === 0);
st = await adapter.getEquipmentState(conn);
const after = st.circuitArray.find((c) => c.id === spaLight.circuitId).state;
console.log(`Spa Light state ${before} -> ${after} (write works: ${before !== after})`);
await adapter.setCircuitState(conn, spaLight.circuitId, before !== 0); // restore

// 2) Setpoint bodyIndex check on the POOL (index 0): nudge +1, read, restore.
st = await adapter.getEquipmentState(conn);
const poolBody = st.bodies.find((b) => b.id === 1); // hardware body id 1 = pool
const origSet = poolBody.setPoint;
await adapter.setSetPoint(conn, 0, origSet + 1);     // BodyIndex.POOL = 0
st = await adapter.getEquipmentState(conn);
const newSet = st.bodies.find((b) => b.id === 1).setPoint;
console.log(`Pool setpoint ${origSet} -> ${newSet} via bodyIndex 0 (correct body: ${newSet === origSet + 1})`);
await adapter.setSetPoint(conn, 0, origSet);          // restore

await adapter.close(conn);
process.exit(0);
```

- [ ] **Step 2: Run it (LIVE), capture output, then delete the probe**

Run: `node probe-writes.mjs` then `rm -f probe-writes.mjs`
Expected: "write works: true" and "correct body: true". Paste the literal output.

> **Checkpoint:** If "correct body" is false (bodyIndex 0 did not change the pool's setpoint), the `BodyIndex` mapping for this panel differs — record what index *did* change the pool and adjust `BODY_INDEX` in Task 5 accordingly. If circuit write didn't take, STOP and report. The yard-light runtime units (minutes) are confirmed during the Task 7 live check.

- [ ] **Step 3: Commit** (nothing to commit — note the probe results in the task handoff). Skip if no file changed.

---

### Task 3: Circuit-role resolver (pure)

**Files:** Create: `src/circuitRoles.js`; Test: `test/circuitRoles.test.js`

- [ ] **Step 1: Write the failing test** `test/circuitRoles.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRole, ROLE_NAMES } from '../src/circuitRoles.js';

const circuits = [
  { id: 6, name: 'Pool', on: false },
  { id: 1, name: 'Spa', on: false },
  { id: 7, name: 'Spillway', on: false },
  { id: 3, name: 'Pool Light', on: false },
  { id: 5, name: 'Yard Light', on: false },
];

test('resolves a known role to its circuit id (case-insensitive)', () => {
  assert.equal(resolveRole('pool', circuits), 6);
  assert.equal(resolveRole('spillway', circuits), 7);
  assert.equal(resolveRole('poolLight', circuits), 3);
});

test('returns null for an unknown role key', () => {
  assert.equal(resolveRole('nope', circuits), null);
});

test('returns null when the role circuit is absent', () => {
  assert.equal(resolveRole('spaLight', circuits), null); // not in list
});

test('ROLE_NAMES covers the six controllable roles', () => {
  assert.deepEqual(Object.keys(ROLE_NAMES).sort(), ['pool', 'poolLight', 'spa', 'spaLight', 'spillway', 'yardLight'].sort());
});
```

- [ ] **Step 2: Run, confirm it fails**

Run: `node --test test/circuitRoles.test.js`
Expected: FAIL — cannot find `../src/circuitRoles.js`.

- [ ] **Step 3: Implement** `src/circuitRoles.js`:

```javascript
/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export const ROLE_NAMES = {
  pool: 'Pool',
  spa: 'Spa',
  spillway: 'Spillway',
  poolLight: 'Pool Light',
  spaLight: 'Spa Light',
  yardLight: 'Yard Light',
};

export function resolveRole(role, circuits = []) {
  const name = ROLE_NAMES[role];
  if (!name) return null;
  const match = circuits.find((c) => c.name?.toLowerCase() === name.toLowerCase());
  return match ? match.id : null;
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `node --test test/circuitRoles.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/circuitRoles.js test/circuitRoles.test.js
git commit -m "feat: circuit-role resolver"
```

---

### Task 4: gatewaySession.sendCommand

**Files:** Modify: `src/gatewaySession.js`; Test: `test/gatewaySession.test.js`

- [ ] **Step 1: Add failing tests** — append to `test/gatewaySession.test.js`:

```javascript
test('sendCommand runs the fn on the live connection when connected', async () => {
  const d = deps();
  let received = null;
  const session = createSession(d);
  await once(session, 'status'); // now connected
  const result = await session.sendCommand((conn) => { received = conn; return 'ok'; });
  assert.equal(result, 'ok');
  assert.deepEqual(received, { id: 'conn' }); // the fake adapter's conn handle
  session.stop();
});

test('sendCommand rejects when not connected', async () => {
  const d = deps();
  const session = createSession(d); // connect is async; conn not established yet
  await assert.rejects(() => session.sendCommand(() => 'x'), /not connected/i);
  session.stop();
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `node --test test/gatewaySession.test.js`
Expected: FAIL — `session.sendCommand is not a function`.

- [ ] **Step 3: Implement** in `src/gatewaySession.js`. Add this function just before the `emitter.stop = stop;` line:

```javascript
  async function sendCommand(fn) {
    if (stopped || !conn) throw new Error('not connected');
    return fn(conn);
  }
```

Then expose it next to `stop`. Change:
```javascript
  emitter.stop = stop;
```
to:
```javascript
  emitter.stop = stop;
  emitter.sendCommand = sendCommand;
```

- [ ] **Step 4: Run, confirm pass**

Run: `node --test test/gatewaySession.test.js`
Expected: PASS (all prior tests + the 2 new ones).

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/gatewaySession.js test/gatewaySession.test.js
git commit -m "feat: gatewaySession.sendCommand for write commands"
```

---

### Task 5: server POST /api/command

**Files:** Modify: `src/server.js`, `src/index.js`; Test: `test/server.test.js`

- [ ] **Step 1: Add failing tests** — append to `test/server.test.js`:

```javascript
function fakeAdapter() {
  const calls = [];
  return {
    calls,
    setCircuitState: (conn, id, on) => { calls.push(['circuit', id, on]); return Promise.resolve(); },
    setSetPoint: (conn, body, t) => { calls.push(['setpoint', body, t]); return Promise.resolve(); },
    setCircuitRuntime: (conn, id, m) => { calls.push(['runtime', id, m]); return Promise.resolve(); },
  };
}

function connectedSession() {
  const s = new EventEmitter();
  s.sendCommand = (fn) => Promise.resolve(fn({ id: 'conn' }));
  return s;
}

test('POST /api/command toggles a circuit by role', async () => {
  const session = connectedSession();
  const adapter = fakeAdapter();
  const app = createServer(session, adapter);
  session.emit('status', { circuits: [{ id: 6, name: 'Pool', on: false }], gateway: {} });

  const res = await request(app).post('/api/command').send({ action: 'circuit', role: 'pool', on: true });
  assert.equal(res.status, 200);
  assert.deepEqual(adapter.calls, [['circuit', 6, true]]);
});

test('POST /api/command sets a setpoint within range', async () => {
  const session = connectedSession();
  const adapter = fakeAdapter();
  const app = createServer(session, adapter);
  session.emit('status', { circuits: [], gateway: {} });

  const res = await request(app).post('/api/command').send({ action: 'setpoint', body: 'spa', tempF: 100 });
  assert.equal(res.status, 200);
  assert.deepEqual(adapter.calls, [['setpoint', 1, 100]]); // BodyIndex.SPA = 1
});

test('POST /api/command rejects out-of-range setpoint, unknown role, unknown action', async () => {
  const session = connectedSession();
  const app = createServer(session, fakeAdapter());
  session.emit('status', { circuits: [{ id: 6, name: 'Pool', on: false }], gateway: {} });

  assert.equal((await request(app).post('/api/command').send({ action: 'setpoint', body: 'pool', tempF: 200 })).status, 400);
  assert.equal((await request(app).post('/api/command').send({ action: 'circuit', role: 'spaLight', on: true })).status, 400);
  assert.equal((await request(app).post('/api/command').send({ action: 'bogus' })).status, 400);
});

test('POST /api/command returns 503 when the session is not connected', async () => {
  const session = new EventEmitter();
  session.sendCommand = () => Promise.reject(new Error('not connected'));
  const app = createServer(session, fakeAdapter());
  session.emit('status', { circuits: [{ id: 6, name: 'Pool', on: false }], gateway: {} });

  const res = await request(app).post('/api/command').send({ action: 'circuit', role: 'pool', on: true });
  assert.equal(res.status, 503);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `node --test test/server.test.js`
Expected: FAIL — `createServer` ignores the 2nd arg / no `/api/command` route (404, not the expected codes).

- [ ] **Step 3: Implement** in `src/server.js`.

(a) Add imports at the top (after the existing imports):
```javascript
import { resolveRole } from './circuitRoles.js';
```

(b) Change the signature:
```javascript
export function createServer(session) {
```
to:
```javascript
const BODY_INDEX = { pool: 0, spa: 1 }; // BodyIndex enum: POOL=0, SPA=1
const SETPOINT_MIN = 40;
const SETPOINT_MAX = 104;

export function createServer(session, adapter) {
```

(c) Right after `const app = express();` add:
```javascript
  app.use(express.json());
```

(d) Add the route just before `app.use(express.static(publicDir));`:
```javascript
  app.post('/api/command', async (req, res) => {
    const body = req.body ?? {};
    const circuits = lastStatus?.circuits ?? [];
    try {
      if (body.action === 'circuit') {
        const id = resolveRole(body.role, circuits);
        if (id == null) return res.status(400).json({ error: 'unknown circuit role' });
        if (typeof body.on !== 'boolean') return res.status(400).json({ error: 'on must be boolean' });
        await session.sendCommand((conn) => adapter.setCircuitState(conn, id, body.on));
        return res.json({ ok: true });
      }
      if (body.action === 'setpoint') {
        const bodyIndex = BODY_INDEX[body.body];
        if (bodyIndex === undefined) return res.status(400).json({ error: 'unknown body' });
        if (typeof body.tempF !== 'number' || body.tempF < SETPOINT_MIN || body.tempF > SETPOINT_MAX) {
          return res.status(400).json({ error: 'setpoint out of range' });
        }
        await session.sendCommand((conn) => adapter.setSetPoint(conn, bodyIndex, body.tempF));
        return res.json({ ok: true });
      }
      if (body.action === 'extend') {
        const id = resolveRole(body.role, circuits);
        if (id == null) return res.status(400).json({ error: 'unknown circuit role' });
        if (typeof body.minutes !== 'number' || body.minutes <= 0 || body.minutes > 240) {
          return res.status(400).json({ error: 'minutes out of range' });
        }
        await session.sendCommand((conn) => adapter.setCircuitRuntime(conn, id, body.minutes));
        return res.json({ ok: true });
      }
      return res.status(400).json({ error: 'unknown action' });
    } catch (err) {
      const code = /not connected/i.test(err.message) ? 503 : 502;
      return res.status(code).json({ error: err.message });
    }
  });
```

- [ ] **Step 4: Wire the adapter in `src/index.js`.** Change:
```javascript
const app = createServer(session);
```
to:
```javascript
const app = createServer(session, adapter);
```

- [ ] **Step 5: Run, confirm pass**

Run: `node --test test/server.test.js` then `npm test`
Expected: all green (existing GET tests still pass — they call `createServer(session)` with adapter undefined and never hit the POST route).

- [ ] **Step 6: Commit**

```bash
git add src/server.js src/index.js test/server.test.js
git commit -m "feat: POST /api/command write endpoint with validation"
```

---

### Task 6: Frontend navigation shell + Schedules view

Refactor the page into two views (Control / Schedules) without changing what data shows yet. The schedule list moves into its own view; everything else stays under Control.

**Files:** Modify: `public/index.html`, `public/app.js`

- [ ] **Step 1: Restructure `public/index.html`.** Replace the `<body>` contents (keep the doctype, license comment, head). Set the body to:

```html
<body>
  <header>
    <strong>Pool — EE-59-51</strong>
    <nav id="tabs">
      <button class="tab active" data-view="control">Control</button>
      <button class="tab" data-view="schedules">Schedules</button>
    </nav>
    <span><span id="controller-time">—</span> &nbsp; updated <span id="updated">—</span></span>
  </header>
  <div id="banner">Disconnected — retrying…</div>
  <main id="view-control" class="view"></main>
  <main id="view-schedules" class="view" hidden></main>
  <div id="toast"></div>
  <script src="/app.js"></script>
</body>
```

And add these rules to the existing `<style>` block (append before `</style>`):
```css
    nav#tabs { display:flex; gap:.5rem; }
    .tab { background:#1b2735; color:#8b98a5; border:none; padding:.4rem .9rem; border-radius:999px; font-weight:600; cursor:pointer; }
    .tab.active { background:#1d6fb8; color:#fff; }
    .view[hidden] { display:none; }
    #toast { position:fixed; bottom:1rem; left:50%; transform:translateX(-50%); background:#7a1f1f; color:#fff; padding:.6rem 1rem; border-radius:8px; opacity:0; transition:opacity .2s; pointer-events:none; }
    #toast.show { opacity:1; }
```

- [ ] **Step 2: Rework `public/app.js`** to render two views and switch tabs. Replace the whole file body (keep the license header) with:

```javascript
const banner = document.getElementById('banner');
const updated = document.getElementById('updated');
const controllerTime = document.getElementById('controller-time');
const viewControl = document.getElementById('view-control');
const viewSchedules = document.getElementById('view-schedules');
const toastEl = document.getElementById('toast');

let lastStatus = null;

document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === btn));
  const view = btn.dataset.view;
  viewControl.hidden = view !== 'control';
  viewSchedules.hidden = view !== 'schedules';
});

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2500);
}

function renderControl(s) {
  const parts = [];
  if (s.air) parts.push(`<div class="card"><h2>Air</h2><div class="big">${s.air.tempF}&deg;</div></div>`);
  const t = (title, b) => b ? `<div class="card"><h2>${title}</h2><div class="big">${b.tempF}&deg;</div><div>set ${b.setpointF}&deg; · ${b.heaterOn ? '<span class="on">heating</span>' : '<span class="off">idle</span>'}</div></div>` : '';
  parts.push(t('Pool', s.pool));
  parts.push(t('Spa', s.spa));
  if (s.circuits?.length) {
    const items = s.circuits.map((c) => `<li><span>${c.name}</span><span class="${c.on ? 'on' : 'off'}">${c.on ? 'ON' : 'off'}</span></li>`).join('');
    parts.push(`<div class="card"><h2>Circuits</h2><ul>${items}</ul></div>`);
  }
  if (s.chemistry) parts.push(`<div class="card"><h2>Chemistry</h2><div>pH ${s.chemistry.ph}</div><div>ORP ${s.chemistry.orp}</div><div>Salt ${s.chemistry.saltPPM} ppm</div></div>`);
  viewControl.innerHTML = parts.join('');
}

function renderSchedules(s) {
  if (!s.schedules) { viewSchedules.innerHTML = ''; return; }
  const rows = s.schedules.length
    ? s.schedules.map((sch) => {
        const days = sch.days?.length === 7 ? 'Every day' : (sch.days || []).join(' ');
        const tag = sch.type === 'run-once' ? ' <span class="off">once</span>' : '';
        return `<li><span>${sch.circuit}${tag}</span><span>${sch.start}–${sch.stop} · ${days}</span></li>`;
      }).join('')
    : '<li><span class="off">No schedules</span></li>';
  viewSchedules.innerHTML = `<div class="card"><h2>Schedules</h2><ul>${rows}</ul></div>`;
}

function render(s) {
  lastStatus = s;
  renderControl(s);
  renderSchedules(s);
  if (s.gateway?.lastUpdate) updated.textContent = new Date(s.gateway.lastUpdate).toLocaleTimeString();
  if (s.systemTime?.clock) controllerTime.textContent = `Controller ${s.systemTime.clock.slice(11)}`;
}

function connect() {
  const es = new EventSource('/events');
  es.onmessage = (e) => { banner.classList.remove('show'); render(JSON.parse(e.data)); };
  es.onerror = () => { banner.classList.add('show'); };
}
connect();
```

- [ ] **Step 3: Confirm unit suite green** (frontend not unit-tested):

Run: `npm test`
Expected: all pass.

- [ ] **Step 4: LIVE check.** Stop any server (`pkill -f "node src/index.js" 2>/dev/null; sleep 1`), then `PORT=3210 node src/index.js &`, `sleep 8`, open `http://localhost:3210`. Confirm: two tabs (Control/Schedules); Control shows Air/Pool/Spa/Circuits/Chemistry; Schedules tab shows the three schedules. `kill` the server. (Use port 3210; the user's dashboard may run on 3000.)

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: navigation shell with Control and Schedules views"
```

---

### Task 7: Interactive Control view — hero tiles, lights, confirm, optimistic + reconcile

Replace the read-only Control rendering with the interactive hero-tile panel and wire commands. This is the cohesive frontend control unit; verified live (frontend isn't unit-tested).

**Files:** Modify: `public/index.html` (styles), `public/app.js`

- [ ] **Step 1: Add control-panel styles** to `public/index.html` `<style>` (append before `</style>`):

```css
    .ctl { max-width:520px; margin:0 auto; display:flex; flex-direction:column; gap:12px; }
    .tile { border-radius:18px; padding:16px; color:#fff; transition:box-shadow .25s, opacity .25s, filter .25s; }
    .tile.off { opacity:.5; filter:saturate(.5); }
    .tile.glow-pool { box-shadow:0 0 0 2px rgba(56,160,230,.95), 0 0 26px 3px rgba(29,111,184,.6); }
    .tile.glow-spa { box-shadow:0 0 0 2px rgba(240,150,90,.95), 0 0 26px 3px rgba(194,98,42,.6); }
    .tile.glow-spill { box-shadow:0 0 0 2px rgba(45,212,191,.95), 0 0 26px 3px rgba(14,165,183,.6); }
    .tile.glow-light { box-shadow:0 0 0 2px rgba(34,211,238,.95), 0 0 24px 3px rgba(8,145,178,.6); }
    .tile.pending { animation:pulse 1s ease-in-out infinite; }
    @keyframes pulse { 0%,100% { box-shadow:0 0 0 2px rgba(255,255,255,.5);} 50% { box-shadow:0 0 0 2px rgba(255,255,255,.95), 0 0 22px 3px rgba(255,255,255,.5);} }
    .lblrow { display:flex; align-items:center; gap:9px; }
    .ico { width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.2); display:inline-flex;align-items:center;justify-content:center;font-size:15px;}
    .lbl { text-transform:uppercase; letter-spacing:.08em; font-size:11px; }
    .sbadge { font-size:10px; background:rgba(255,255,255,.18); border-radius:999px; padding:2px 8px; }
    .temp { font-size:38px; font-weight:700; line-height:1; }
    .pill { display:inline-flex; align-items:center; gap:8px; background:rgba(255,255,255,.2); border-radius:999px; padding:7px 14px; font-weight:600; font-size:13px; cursor:pointer; border:none; color:#fff; }
    .dot { width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,.6);}
    .dot.on { background:#3fb950; box-shadow:0 0 9px #3fb950; }
    .stepper { display:inline-flex; align-items:center; gap:12px; background:rgba(255,255,255,.14); border-radius:10px; padding:5px 12px; font-weight:700; }
    .stepper button { background:none;border:none;color:#fff;font-size:18px;cursor:pointer;width:24px; }
    .cbtn { border:none; border-radius:10px; padding:8px 14px; font-weight:700; font-size:13px; color:#fff; cursor:pointer; }
    .confirm { background:#3fb950; } .cancel { background:rgba(255,255,255,.18); }
    .row2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .seclabel { text-transform:uppercase; letter-spacing:.08em; font-size:11px; color:#8b98a5; margin:8px 4px 0; }
    .infogrid { display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); margin-top:6px; }
```

- [ ] **Step 2: Replace `public/app.js`** with the interactive version (keep the license header at top). Full file body:

```javascript
const banner = document.getElementById('banner');
const updated = document.getElementById('updated');
const controllerTime = document.getElementById('controller-time');
const viewControl = document.getElementById('view-control');
const viewSchedules = document.getElementById('view-schedules');
const toastEl = document.getElementById('toast');

let lastStatus = null;
// Local UI state: optimistic overrides + confirm/setpoint editing.
const pending = new Map();   // role -> { on, ts }
const confirming = new Set(); // roles awaiting inline confirm
const setEdit = new Map();    // body -> pending setpoint number

const GLOW = { pool: 'glow-pool', spa: 'glow-spa', spillway: 'glow-spill', poolLight: 'glow-light', spaLight: 'glow-light', yardLight: 'glow-light' };

document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === btn));
  viewControl.hidden = btn.dataset.view !== 'control';
  viewSchedules.hidden = btn.dataset.view !== 'schedules';
});

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2500);
}

function circuit(s, name) {
  return (s.circuits || []).find((c) => c.name?.toLowerCase() === name.toLowerCase());
}
// On-state for a role, honoring an optimistic override.
function isOn(role, actual) {
  const p = pending.get(role);
  return p ? p.on : actual;
}

async function postCommand(payload, role) {
  try {
    const res = await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${res.status}`);
    }
  } catch (err) {
    if (role) pending.delete(role);
    toast(`Command failed: ${err.message}`);
    render(lastStatus);
  }
}

function toggleCircuit(role, name, currentlyOn) {
  // Off is instant; on for guarded roles needs inline confirm.
  const guarded = role === 'pool' || role === 'spa' || role === 'spillway';
  if (!currentlyOn && guarded && !confirming.has(role)) { confirming.add(role); render(lastStatus); return; }
  confirming.delete(role);
  const desired = !currentlyOn;
  pending.set(role, { on: desired, ts: Date.now() });
  render(lastStatus);
  postCommand({ action: 'circuit', role, on: desired }, role);
}

function applySetpoint(body) {
  const tempF = setEdit.get(body);
  if (tempF == null) return;
  setEdit.delete(body);
  render(lastStatus);
  postCommand({ action: 'setpoint', body, tempF });
}

function extendYard(minutes) {
  pending.set('yardLight', { on: true, ts: Date.now() });
  render(lastStatus);
  postCommand({ action: 'extend', role: 'yardLight', minutes }, 'yardLight');
}

// ---- rendering ----
function bodyTile(s, role, name, icon, glowClass, scheduleBadge) {
  const c = circuit(s, name);
  if (!c || !s[role]) return '';
  const on = isOn(role, c.on);
  const isPending = pending.has(role);
  const editing = setEdit.has(role === 'pool' ? 'pool' : 'spa');
  const body = role === 'pool' ? 'pool' : 'spa';
  const setVal = setEdit.has(body) ? setEdit.get(body) : s[role].setpointF;
  const cls = `tile ${on ? glowClass : 'off'}${isPending ? ' pending' : ''}`;
  const toggle = confirming.has(role)
    ? `<span><button class="cbtn confirm" data-act="toggle" data-role="${role}" data-name="${name}" data-on="${c.on}">✓ Turn on</button> <button class="cbtn cancel" data-act="cancelconfirm" data-role="${role}">Cancel</button></span>`
    : `<button class="pill" data-act="toggle" data-role="${role}" data-name="${name}" data-on="${c.on}"><span class="dot ${on ? 'on' : ''}"></span> ${on ? 'ON' : 'OFF'}</button>`;
  return `<div class="${cls}">
    <div class="lblrow"><span class="ico">${icon}</span><span class="lbl">${name}</span>${scheduleBadge ? `<span class="sbadge">⏱ ${scheduleBadge}</span>` : ''}</div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:10px;"><div class="temp">${s[role].tempF}&deg;</div>${toggle}</div>
    <div style="margin-top:12px;"><span class="stepper"><button data-act="setdn" data-body="${body}" data-cur="${setVal}">−</button><b>${setVal}&deg;</b><button data-act="setup" data-body="${body}" data-cur="${setVal}">+</button></span>
      ${editing ? `<button class="cbtn confirm" data-act="applyset" data-body="${body}" style="margin-left:10px;">Apply ${setVal}&deg;</button>` : ''}</div>
  </div>`;
}

function featureTile(s, role, name, icon, glowClass) {
  const c = circuit(s, name);
  if (!c) return '';
  const on = isOn(role, c.on);
  const isPending = pending.has(role);
  const cls = `tile ${on ? glowClass : 'off'}${isPending ? ' pending' : ''}`;
  const toggle = confirming.has(role)
    ? `<span><button class="cbtn confirm" data-act="toggle" data-role="${role}" data-name="${name}" data-on="${c.on}">✓ Turn on</button> <button class="cbtn cancel" data-act="cancelconfirm" data-role="${role}">Cancel</button></span>`
    : `<button class="pill" data-act="toggle" data-role="${role}" data-name="${name}" data-on="${c.on}"><span class="dot ${on ? 'on' : ''}"></span> ${on ? 'ON' : 'OFF'}</button>`;
  return `<div class="${cls}" style="display:flex;justify-content:space-between;align-items:center;">
    <div class="lblrow"><span class="ico">${icon}</span><div><span class="lbl">${name}</span><div style="font-size:12px;opacity:.85;">Run any time</div></div></div>${toggle}</div>`;
}

function lightTile(s, role, name, icon) {
  const c = circuit(s, name);
  if (!c) return '';
  const on = isOn(role, c.on);
  const cls = `tile ${on ? GLOW[role] : 'off'}${pending.has(role) ? ' pending' : ''}`;
  return `<div class="${cls}"><div class="lblrow"><span class="ico">${icon}</span><span class="lbl">${name}</span></div>
    <div style="margin-top:12px;"><button class="pill" data-act="toggle" data-role="${role}" data-name="${name}" data-on="${c.on}"><span class="dot ${on ? 'on' : ''}"></span> ${on ? 'ON' : 'OFF'}</button></div></div>`;
}

function yardTile(s) {
  const c = circuit(s, 'Yard Light');
  if (!c) return '';
  const on = isOn('yardLight', c.on);
  const sched = (s.schedules || []).find((x) => x.circuit?.toLowerCase() === 'yard light');
  const cls = `tile ${on ? GLOW.yardLight : 'off'}${pending.has('yardLight') ? ' pending' : ''}`;
  return `<div class="${cls}" style="display:flex;justify-content:space-between;align-items:center;">
    <div class="lblrow"><span class="ico">🌙</span><div><span class="lbl">Yard Light</span>${sched ? `<span class="sbadge" style="margin-left:8px;">⏱ ${sched.start}–${sched.stop}</span>` : ''}<div style="font-size:12px;opacity:.85;">${on ? 'on' : 'off now'}</div></div></div>
    <div style="display:flex;gap:8px;"><button class="cbtn cancel" data-act="extend" data-min="30">Extend +30m</button><button class="cbtn cancel" data-act="extend" data-min="60">+1 hr</button><button class="pill" data-act="toggle" data-role="yardLight" data-name="Yard Light" data-on="${c.on}">On now</button></div></div>`;
}

function renderControl(s) {
  const tiles = [
    bodyTile(s, 'pool', 'Pool', '🏊', GLOW.pool, '9–1'),
    featureTile(s, 'spillway', 'Spillway', '⛲', GLOW.spillway),
    bodyTile(s, 'spa', 'Spa', '♨️', GLOW.spa, ''),
    '<div class="seclabel">Lights</div>',
    `<div class="row2">${lightTile(s, 'poolLight', 'Pool Light', '💡')}${lightTile(s, 'spaLight', 'Spa Light', '💡')}</div>`,
    yardTile(s),
  ].filter(Boolean);
  const info = [];
  if (s.air) info.push(`<div class="card"><h2>Air</h2><div class="big">${s.air.tempF}&deg;</div></div>`);
  if (s.chemistry) info.push(`<div class="card"><h2>Chemistry</h2><div>pH ${s.chemistry.ph}</div><div>ORP ${s.chemistry.orp}</div><div>Salt ${s.chemistry.saltPPM} ppm</div></div>`);
  viewControl.innerHTML = `<div class="ctl">${tiles.join('')}</div>${info.length ? `<div class="infogrid">${info.join('')}</div>` : ''}`;
}

function renderSchedules(s) {
  if (!s.schedules) { viewSchedules.innerHTML = ''; return; }
  const rows = s.schedules.length
    ? s.schedules.map((sch) => {
        const days = sch.days?.length === 7 ? 'Every day' : (sch.days || []).join(' ');
        const tag = sch.type === 'run-once' ? ' <span class="off">once</span>' : '';
        return `<li><span>${sch.circuit}${tag}</span><span>${sch.start}–${sch.stop} · ${days}</span></li>`;
      }).join('')
    : '<li><span class="off">No schedules</span></li>';
  viewSchedules.innerHTML = `<div class="card"><h2>Schedules</h2><ul>${rows}</ul></div>`;
}

function reconcile(s) {
  // Drop optimistic overrides once the gateway reflects them or after 10s.
  for (const [role, p] of pending) {
    const name = { pool: 'Pool', spa: 'Spa', spillway: 'Spillway', poolLight: 'Pool Light', spaLight: 'Spa Light', yardLight: 'Yard Light' }[role];
    const c = (s.circuits || []).find((x) => x.name?.toLowerCase() === name.toLowerCase());
    if ((c && c.on === p.on) || Date.now() - p.ts > 10000) pending.delete(role);
  }
}

function render(s) {
  if (!s) return;
  lastStatus = s;
  renderControl(s);
  renderSchedules(s);
  if (s.gateway?.lastUpdate) updated.textContent = new Date(s.gateway.lastUpdate).toLocaleTimeString();
  if (s.systemTime?.clock) controllerTime.textContent = `Controller ${s.systemTime.clock.slice(11)}`;
}

viewControl.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'toggle') toggleCircuit(el.dataset.role, el.dataset.name, el.dataset.on === 'true');
  else if (act === 'cancelconfirm') { confirming.delete(el.dataset.role); render(lastStatus); }
  else if (act === 'setup' || act === 'setdn') {
    const body = el.dataset.body; const cur = Number(el.dataset.cur);
    const next = Math.max(40, Math.min(104, cur + (act === 'setup' ? 1 : -1)));
    setEdit.set(body, next); render(lastStatus);
  } else if (act === 'applyset') applySetpoint(el.dataset.body);
  else if (act === 'extend') extendYard(Number(el.dataset.min));
});

function connect() {
  const es = new EventSource('/events');
  es.onmessage = (e) => { banner.classList.remove('show'); const s = JSON.parse(e.data); reconcile(s); render(s); };
  es.onerror = () => { banner.classList.add('show'); };
}
connect();
```

- [ ] **Step 3: Confirm unit suite green**

Run: `npm test`
Expected: all pass (no backend change here).

- [ ] **Step 4: LIVE end-to-end verification.** Stop any server, then `PORT=3210 node src/index.js &`, `sleep 8`, open `http://localhost:3210`:
  - Control view shows Pool → Spillway → Spa tiles, a Lights row (Pool/Spa light), Yard Light with schedule + Extend/On-now, and Air/Chemistry info below.
  - Tap **Spa Light** (instant): it flips with a pending pulse and settles to a cyan glow within ~5s; tap again to turn off. (Safe, reversible.)
  - Tap **Spillway** ON → inline `✓ Turn on / Cancel` appears; click Cancel (no command). Then confirm the ✓ path actuates and reconciles, and turn it back off (off is instant).
  - Adjust **Pool** setpoint −/+ then **Apply**; confirm the tile's "set" value matches after the next poll, then restore the original.
  - Confirm a bad path: with the gateway briefly unreachable (or by stopping mid-action) a failed command shows the toast and the control reverts.
  - Verify the **Extend +30m** on Yard Light turns it on (check it auto-offs later / matches the runtime); if the runtime units aren't minutes, note it and adjust `extend` minutes handling.
  - `kill` the server.

  Paste the `/status`-confirmed before/after for one toggle (e.g., Spa Light state) as evidence.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: interactive control panel with inline confirm and optimistic reconcile"
```

---

## Verification Checklist (before done)

- [ ] `npm test` — all suites pass (config, discovery, normalize, gatewaySession, server, circuitRoles).
- [ ] Live: toggling a light actuates and reconciles within one poll; inline confirm guards Spa/Spillway/Pool on; setpoint Apply works; failed command reverts + toasts.
- [ ] Nav: Control and Schedules views switch; schedules list intact.
- [ ] Guarded "on" confirms; "off" and lights are instant. Lights never confirm.
- [ ] No command can be sent when disconnected (503 → UI revert).
