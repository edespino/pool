# Pumps View (Read-Only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Pumps view showing the IntelliFlo VS pump's identity, live telemetry (running/RPM/watts/GPM), and its per-circuit programmed speed presets — no adjustment.

**Architecture:** Mirrors the existing read-only patterns: a new nav tab, a best-effort per-poll pump-status fetch attached to the SSE status, a pure `normalizePump`, and a read-only view. No write path or new server endpoint.

**Tech Stack:** Node.js (ESM), node-screenlogic 2.1.1, Express + SSE, vanilla JS, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-04-pumps-view-design.md`

**Confirmed:** one pump at id **1**; `getPumpStatusAsync(1)` → `pumpType=3` (`INTELLIFLOVS`), `isRunning`, `pumpRPMs`, `pumpWatts`, `pumpGPMs`, `pumpCircuits[{circuitId,speed,isRPMs}]`. `conn.pump.getPumpStatusAsync` is the read call.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/config.js` | modify | `pumpId` (env `POOL_PUMP_ID`, default 1) |
| `src/slAdapter.js` | modify | `getPumpStatus(conn, pumpId)` read wrapper |
| `src/normalize.js` | modify | `normalizePump(rawPumpStatus, controllerConfig)` |
| `src/gatewaySession.js` | modify | best-effort per-poll pump fetch → `status.pump` |
| `public/index.html` | modify | Pumps tab + `#view-pumps` container |
| `public/app.js` | modify | tab switch for 3 views + `renderPumps` |
| `test/config.test.js` | modify | `pumpId` assertions |
| `test/normalize.test.js` | modify | `normalizePump` tests |
| `test/gatewaySession.test.js` | modify | pump-fetch tests |
| `test/fixtures/pumpStatus.json` | create | real-shaped pump payload |

---

### Task PV-1: config `pumpId` + adapter `getPumpStatus`

**Files:** Modify `src/config.js`, `src/slAdapter.js`, `test/config.test.js`

- [ ] **Step 1: Add config assertions** in `test/config.test.js`. In the test `'loadConfig applies defaults when env is empty'`, add:
```javascript
  assert.equal(cfg.pumpId, 1);
```
In the test `'loadConfig reads overrides and coerces numbers'`, add `POOL_PUMP_ID: '2'` to the env object passed to `loadConfig`, and add:
```javascript
  assert.equal(cfg.pumpId, 2);
```

- [ ] **Step 2: Run, confirm fail**

Run: `node --test test/config.test.js`
Expected: FAIL — `cfg.pumpId` is undefined.

- [ ] **Step 3: Implement in `src/config.js`.** In the object returned by `loadConfig`, add this property (after `webPort`):
```javascript
    pumpId: num(env.POOL_PUMP_ID, 1),
```

- [ ] **Step 4: Run, confirm pass**

Run: `node --test test/config.test.js`
Expected: PASS.

- [ ] **Step 5: Add the adapter wrapper** in `src/slAdapter.js`, after `getSchedules` (before the write wrappers or `close`):
```javascript
export function getPumpStatus(conn, pumpId) {
  return conn.pump.getPumpStatusAsync(pumpId);
}
```

- [ ] **Step 6: Verify adapter loads**

Run: `node -e "import('./src/slAdapter.js').then(m => console.log('getPumpStatus' in m))"`
Expected: `true`. No live connection.

- [ ] **Step 7: Commit**

```bash
git add src/config.js src/slAdapter.js test/config.test.js
git commit -m "feat: pumpId config and getPumpStatus adapter wrapper"
```

---

### Task PV-2: normalizePump

**Files:** Create `test/fixtures/pumpStatus.json`; Modify `src/normalize.js`, `test/normalize.test.js`

- [ ] **Step 1: Create the fixture** `test/fixtures/pumpStatus.json` (real probe shape):
```json
{
  "pumpType": 3,
  "isRunning": false,
  "pumpRPMs": 0,
  "pumpWatts": 0,
  "pumpGPMs": 0,
  "pumpCircuits": [
    { "circuitId": 6, "speed": 2600, "isRPMs": true },
    { "circuitId": 1, "speed": 3450, "isRPMs": true },
    { "circuitId": 2, "speed": 2400, "isRPMs": true },
    { "circuitId": 130, "speed": 2700, "isRPMs": true },
    { "circuitId": 132, "speed": 610, "isRPMs": true },
    { "circuitId": 7, "speed": 2750, "isRPMs": true },
    { "circuitId": 9, "speed": 3450, "isRPMs": true },
    { "circuitId": 0, "speed": 1000, "isRPMs": true }
  ]
}
```

- [ ] **Step 2: Write the failing tests** — append to `test/normalize.test.js`:
```javascript
const pumpConfig = {
  circuitArray: [
    { circuitId: 6, name: 'Pool' },
    { circuitId: 1, name: 'Spa' },
    { circuitId: 2, name: 'Cleaner' },
    { circuitId: 7, name: 'Spillway' },
    { circuitId: 9, name: 'Aux 7' },
  ],
};

test('normalizePump identifies the pump and keeps only real-circuit presets', () => {
  const raw = JSON.parse(readFileSync(new URL('./fixtures/pumpStatus.json', import.meta.url)));
  const p = normalizePump(raw, pumpConfig);
  assert.equal(p.model, 'IntelliFlo VS');
  assert.equal(p.running, false);
  assert.deepEqual({ rpm: p.rpm, watts: p.watts, gpm: p.gpm }, { rpm: 0, watts: 0, gpm: 0 });
  assert.deepEqual(p.presets, [
    { circuitId: 6, circuit: 'Pool', rpm: 2600 },
    { circuitId: 1, circuit: 'Spa', rpm: 3450 },
    { circuitId: 2, circuit: 'Cleaner', rpm: 2400 },
    { circuitId: 7, circuit: 'Spillway', rpm: 2750 },
  ]); // Aux 7 filtered; ids 130/132/0 are not real circuits
});

test('normalizePump maps live telemetry and unknown pump types', () => {
  const p = normalizePump({ pumpType: 99, isRunning: true, pumpRPMs: 2600, pumpWatts: 850, pumpGPMs: 60, pumpCircuits: [] }, { circuitArray: [] });
  assert.equal(p.model, 'Pump (type 99)');
  assert.deepEqual({ running: p.running, rpm: p.rpm, watts: p.watts, gpm: p.gpm }, { running: true, rpm: 2600, watts: 850, gpm: 60 });
  assert.deepEqual(p.presets, []);
});
```

- [ ] **Step 3: Update the import** at the top of `test/normalize.test.js`:
```javascript
import { normalizeStatus, normalizeSystemTime, normalizeSchedules } from '../src/normalize.js';
```
to:
```javascript
import { normalizeStatus, normalizeSystemTime, normalizeSchedules, normalizePump } from '../src/normalize.js';
```

- [ ] **Step 4: Run, confirm fail**

Run: `node --test test/normalize.test.js`
Expected: FAIL — `normalizePump is not a function`.

- [ ] **Step 5: Implement in `src/normalize.js`.** Add a model map near the other module constants (after `HIDDEN_CIRCUIT`):
```javascript
const PUMP_MODELS = { 3: 'IntelliFlo VS', 4: 'IntelliFlo VSF', 5: 'IntelliFlo VF' };
```
Add the exported function at the end of the file (it reuses the existing `circuitNames` helper and `HIDDEN_CIRCUIT`):
```javascript
export function normalizePump(rawPumpStatus, controllerConfig = {}) {
  const names = circuitNames(controllerConfig);
  const presets = (rawPumpStatus.pumpCircuits ?? [])
    .filter((pc) => {
      const name = names.get(pc.circuitId);
      return name && !HIDDEN_CIRCUIT.test(name);
    })
    .map((pc) => ({ circuitId: pc.circuitId, circuit: names.get(pc.circuitId), rpm: pc.speed }));
  return {
    model: PUMP_MODELS[rawPumpStatus.pumpType] ?? `Pump (type ${rawPumpStatus.pumpType})`,
    running: !!rawPumpStatus.isRunning,
    rpm: rawPumpStatus.pumpRPMs,
    watts: rawPumpStatus.pumpWatts,
    gpm: rawPumpStatus.pumpGPMs,
    presets,
  };
}
```

- [ ] **Step 6: Run, confirm pass**

Run: `node --test test/normalize.test.js` then `npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/normalize.js test/normalize.test.js test/fixtures/pumpStatus.json
git commit -m "feat: normalizePump (identity, telemetry, real-circuit presets)"
```

---

### Task PV-3: gatewaySession best-effort pump fetch

**Files:** Modify `src/gatewaySession.js`, `test/gatewaySession.test.js`

- [ ] **Step 1: Update the test fixture + add assertions** in `test/gatewaySession.test.js`.

In the `deps()` helper, add `pumpId: 1` to the `config` object. Then add to the `adapter` object:
```javascript
      getPumpStatus: async () => ({ pumpType: 3, isRunning: false, pumpRPMs: 0, pumpWatts: 0, pumpGPMs: 0, pumpCircuits: [{ circuitId: 500, speed: 2600, isRPMs: true }] }),
```
(The deps `getControllerConfig` already returns `{ circuitArray: [{ circuitId: 500, name: 'Pool' }] }`, so circuit 500 resolves to "Pool".)

In the first test (`'emits a normalized status after connecting'`), add before `session.stop();`:
```javascript
  assert.equal(status.pump.model, 'IntelliFlo VS');
  assert.deepEqual(status.pump.presets, [{ circuitId: 500, circuit: 'Pool', rpm: 2600 }]);
```

Append a best-effort test:
```javascript
test('pump-status failure omits pump but still emits status', async () => {
  const d = deps();
  d.adapter.getPumpStatus = async () => { throw new Error('no pump'); };
  const session = createSession(d);
  const [status] = await once(session, 'status');
  assert.equal(status.pump, undefined);
  assert.equal(status.air.tempF, 80);
  session.stop();
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `node --test test/gatewaySession.test.js`
Expected: FAIL — first test fails on `status.pump` being undefined.

- [ ] **Step 3: Implement in `src/gatewaySession.js`.**

(a) Update the import:
```javascript
import { normalizeStatus, normalizeSystemTime, normalizeSchedules } from './normalize.js';
```
to:
```javascript
import { normalizeStatus, normalizeSystemTime, normalizeSchedules, normalizePump } from './normalize.js';
```

(b) In `pollOnce`, add a best-effort pump fetch immediately after the system-time `try/catch` block and before `emitter.emit('status', status);`:
```javascript
    // Pump status is best-effort, like system time.
    try {
      const rawPump = await adapter.getPumpStatus(conn, config.pumpId);
      if (stopped) return;
      status.pump = normalizePump(rawPump, controllerConfig);
    } catch {
      // omit pump this cycle
    }
```

- [ ] **Step 4: Run, confirm pass**

Run: `node --test test/gatewaySession.test.js` then `npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/gatewaySession.js test/gatewaySession.test.js
git commit -m "feat: attach best-effort pump status to the poll"
```

---

### Task PV-4: Pumps tab + read-only view

**Files:** Modify `public/index.html`, `public/app.js`

- [ ] **Step 1: Add the tab + view container** in `public/index.html`.

In the header `<nav id="tabs">`, after the Schedules tab button, add:
```html
      <button class="tab" data-view="pumps">Pumps</button>
```
After the `<main id="view-schedules" ...>` line, add:
```html
  <main id="view-pumps" class="view" hidden></main>
```

- [ ] **Step 2: Wire the third view + render** in `public/app.js`.

(a) Add an element ref after `const viewSchedules = ...`:
```javascript
const viewPumps = document.getElementById('view-pumps');
```

(b) In the `#tabs` click handler, after the `viewSchedules.hidden = ...` line, add:
```javascript
  viewPumps.hidden = btn.dataset.view !== 'pumps';
```

(c) Add a `renderPumps` function (place it next to `renderSchedules`):
```javascript
function renderPumps(s) {
  const p = s.pump;
  if (!p) { viewPumps.innerHTML = '<div class="card"><h2>Pump</h2><div class="off">No pump data</div></div>'; return; }
  const status = p.running
    ? `<span class="on">● Running</span> · ${p.rpm} RPM · ${p.watts} W · ${p.gpm} GPM`
    : '<span class="off">● Off</span>';
  const activeIds = new Set((s.circuits || []).filter((c) => c.on).map((c) => c.id));
  const rows = p.presets.map((pr) => {
    const cls = activeIds.has(pr.circuitId) ? ' class="on"' : '';
    return `<li><span${cls}>${pr.circuit}</span><span${cls}>${pr.rpm} RPM</span></li>`;
  }).join('');
  viewPumps.innerHTML = `<div class="card"><h2>${p.model}</h2>
    <div style="margin:.2rem 0 .8rem;">${status}</div>
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8b98a5;margin-bottom:.3rem;">Programmed speeds (read-only)</div>
    <ul>${rows}</ul></div>`;
}
```

(d) In `render(s)`, add a call alongside the other renders (after `renderSchedules(s);`):
```javascript
  renderPumps(s);
```

- [ ] **Step 3: Confirm unit suite green**

Run: `npm test`
Expected: all pass (no backend change here).

- [ ] **Step 4: LIVE verification.** Stop any server (`pkill -f "node src/index.js" 2>/dev/null; sleep 1`), then `PORT=3210 node src/index.js &`, `sleep 8`:
  - `curl -s http://localhost:3210/ | grep -c 'data-view="pumps"'` → expect 1.
  - `curl -s http://localhost:3210/status | node -e "const s=JSON.parse(require('fs').readFileSync(0));const p=s.pump;console.log('model:',p&&p.model,'running:',p&&p.running);console.log('presets:',(p&&p.presets||[]).map(x=>x.circuit+' '+x.rpm).join(', '))"`
    → expect `model: IntelliFlo VS running: false` (pump idle) and `presets: Pool 2600, Spa 3450, Cleaner 2400, Spillway 2750`.
  - `kill <PID>`. Paste the literal output.
  - Browser (the user's to confirm): the Pumps tab shows the IntelliFlo VS card, Off status, and the four read-only speed rows. Live RPM/watts/GPM appear when the pool actually runs.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: read-only Pumps view tab"
```

---

## Verification Checklist (before done)

- [ ] `npm test` — all suites pass (config, normalize, gatewaySession, etc.).
- [ ] `/status` carries a `pump` block with `model: 'IntelliFlo VS'` and the four real-circuit presets.
- [ ] Pumps tab renders the pump card + read-only speed rows; switches cleanly with Control/Schedules.
- [ ] No write path was added (no `setPumpSpeed` anywhere) — read-only confirmed.
