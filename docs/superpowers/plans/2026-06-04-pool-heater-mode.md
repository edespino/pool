# Pool Heater Mode Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pool heater enable/disable control (gas heater: `HEATER`=3 ↔ `OFF`=0) to the Pool tile, with a loud flickering-red "actively heating" indicator.

**Architecture:** Extends the existing read + write pipelines. `normalize` exposes `heatEnabled` per body; `slAdapter` gains `setHeatMode`; `server` gains a `heatmode` command action; the Pool tile renders a heater chip (enable confirms, disable instant) with optimistic + reconcile, and a red flicker when the gateway reports the heater actively firing.

**Tech Stack:** Node.js (ESM), node-screenlogic 2.1.1, Express + SSE, vanilla JS, Node `node:test` + `supertest`.

**Spec:** `docs/superpowers/specs/2026-06-04-pool-heater-mode-design.md`

**Confirmed:** `BodyIndex.POOL=0`; `HeatModes.OFF=0`, `HeatModes.HEATER=3`; `conn.bodies.setHeatModeAsync(bodyIndex, mode)`. Live: both bodies currently `heatMode=0`.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/normalize.js` | modify | `body()` adds `heatEnabled = heatMode !== 0` |
| `src/slAdapter.js` | modify | `setHeatMode(conn, bodyIndex, mode)` wrapper |
| `src/server.js` | modify | `POST /api/command` action `heatmode` |
| `public/index.html` | modify | heater chip + heating-flicker CSS |
| `public/app.js` | modify | Pool heater chip, toggle/confirm, reconcile, heating indicator |
| `test/normalize.test.js` | modify | `heatEnabled` assertions |
| `test/server.test.js` | modify | `heatmode` action tests |

---

### Task HM-1: normalize exposes `heatEnabled`

**Files:** Modify `src/normalize.js`, `test/normalize.test.js`

- [ ] **Step 1: Update the existing body assertions + add a focused test** in `test/normalize.test.js`.

The test named `'maps pool (body id 1) and spa (body id 2) with heater status'` currently asserts:
```javascript
  assert.deepEqual(s.pool, { tempF: 65, setpointF: 84, heaterOn: false });
  assert.deepEqual(s.spa, { tempF: 102, setpointF: 102, heaterOn: true });
```
Change those two lines to include `heatEnabled` (pool fixture has `heatMode:0`, spa has `heatMode:1`):
```javascript
  assert.deepEqual(s.pool, { tempF: 65, setpointF: 84, heaterOn: false, heatEnabled: false });
  assert.deepEqual(s.spa, { tempF: 102, setpointF: 102, heaterOn: true, heatEnabled: true });
```
Then append a focused test:
```javascript
test('normalizeStatus derives heatEnabled from heatMode (0 = off)', () => {
  const cfg = { circuitArray: [] };
  const base = { airTemp: 70, circuitArray: [], pH: 0 };
  const off = normalizeStatus(cfg, { ...base, bodies: [{ id: 1, currentTemp: 80, setPoint: 85, heatStatus: 0, heatMode: 0 }] });
  assert.equal(off.pool.heatEnabled, false);
  const on = normalizeStatus(cfg, { ...base, bodies: [{ id: 1, currentTemp: 80, setPoint: 85, heatStatus: 0, heatMode: 3 }] });
  assert.equal(on.pool.heatEnabled, true);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `node --test test/normalize.test.js`
Expected: FAIL — `s.pool` lacks `heatEnabled` (deepEqual mismatch) and the new test fails.

- [ ] **Step 3: Implement** in `src/normalize.js`. Change the `body()` helper:
```javascript
function body(state, id) {
  const b = state.bodies?.find((x) => x.id === id);
  if (!b) return undefined;
  return { tempF: b.currentTemp, setpointF: b.setPoint, heaterOn: b.heatStatus !== 0 };
}
```
to:
```javascript
function body(state, id) {
  const b = state.bodies?.find((x) => x.id === id);
  if (!b) return undefined;
  return { tempF: b.currentTemp, setpointF: b.setPoint, heaterOn: b.heatStatus !== 0, heatEnabled: b.heatMode !== 0 };
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `node --test test/normalize.test.js` then `npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/normalize.js test/normalize.test.js
git commit -m "feat: expose heatEnabled (heatMode) on bodies"
```

---

### Task HM-2: adapter setHeatMode wrapper

**Files:** Modify `src/slAdapter.js`

- [ ] **Step 1: Add the wrapper** after `setSetPoint` (before `setCircuitRuntime` or `close`):
```javascript
export function setHeatMode(conn, bodyIndex, mode) {
  return conn.bodies.setHeatModeAsync(bodyIndex, mode);
}
```

- [ ] **Step 2: Verify it loads**

Run: `node -e "import('./src/slAdapter.js').then(m => console.log(Object.keys(m).includes('setHeatMode')))"`
Expected: `true`. No live connection.

- [ ] **Step 3: Commit**

```bash
git add src/slAdapter.js
git commit -m "feat: adapter setHeatMode wrapper"
```

---

### Task HM-3: server `heatmode` command action

**Files:** Modify `src/server.js`, `test/server.test.js`

- [ ] **Step 1: Add failing tests** — in `test/server.test.js`, first extend the `fakeAdapter` helper to record heatmode calls. Change the returned object in `fakeAdapter` to add:
```javascript
    setHeatMode: (conn, bi, mode) => { calls.push(['heatmode', bi, mode]); return Promise.resolve(); },
```
Then append these tests:
```javascript
test('POST /api/command enables the pool heater (HEATER mode 3)', async () => {
  const session = connectedSession();
  const adapter = fakeAdapter();
  const app = createServer(session, adapter);
  session.emit('status', { circuits: [], gateway: {} });

  const res = await request(app).post('/api/command').send({ action: 'heatmode', body: 'pool', enabled: true });
  assert.equal(res.status, 200);
  assert.deepEqual(adapter.calls, [['heatmode', 0, 3]]);
});

test('POST /api/command disables the pool heater (OFF mode 0)', async () => {
  const session = connectedSession();
  const adapter = fakeAdapter();
  const app = createServer(session, adapter);
  session.emit('status', { circuits: [], gateway: {} });

  const res = await request(app).post('/api/command').send({ action: 'heatmode', body: 'pool', enabled: false });
  assert.equal(res.status, 200);
  assert.deepEqual(adapter.calls, [['heatmode', 0, 0]]);
});

test('POST /api/command rejects heatmode with unknown body or non-boolean enabled', async () => {
  const session = connectedSession();
  const app = createServer(session, fakeAdapter());
  session.emit('status', { circuits: [], gateway: {} });

  assert.equal((await request(app).post('/api/command').send({ action: 'heatmode', body: 'patio', enabled: true })).status, 400);
  assert.equal((await request(app).post('/api/command').send({ action: 'heatmode', body: 'pool', enabled: 'yes' })).status, 400);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `node --test test/server.test.js`
Expected: FAIL — heatmode falls through to "unknown action" (400 with wrong adapter calls / the enable test gets 400 not 200).

- [ ] **Step 3: Implement** in `src/server.js`. Add the heatmode branch inside the `POST /api/command` handler, right after the `extend` branch and before the final `return res.status(400).json({ error: 'unknown action' });`:
```javascript
      if (body.action === 'heatmode') {
        const bodyIndex = BODY_INDEX[body.body];
        if (bodyIndex === undefined) return res.status(400).json({ error: 'unknown body' });
        if (typeof body.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });
        await session.sendCommand((conn) => adapter.setHeatMode(conn, bodyIndex, body.enabled ? 3 : 0));
        return res.json({ ok: true });
      }
```
(`3` = `HeatModes.HEATER`, `0` = `HeatModes.OFF`. `BODY_INDEX` and the try/catch 503/502 handling already exist.)

- [ ] **Step 4: Run, confirm pass**

Run: `node --test test/server.test.js` then `npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/server.js test/server.test.js
git commit -m "feat: heatmode command action (enable/disable pool heater)"
```

---

### Task HM-4: Pool tile heater chip + heating indicator

**Files:** Modify `public/index.html`, `public/app.js`

- [ ] **Step 1: Add CSS** to `public/index.html` `<style>` (append before `</style>`):
```css
    .tile.heating { box-shadow:0 0 0 2px rgba(239,68,68,.95), 0 0 30px 5px rgba(239,68,68,.6); animation: heatpulse 1.2s ease-in-out infinite; }
    @keyframes heatpulse { 0%,100% { box-shadow:0 0 0 2px rgba(239,68,68,.8), 0 0 22px 3px rgba(239,68,68,.45);} 50% { box-shadow:0 0 0 2px rgba(239,68,68,1), 0 0 40px 8px rgba(239,68,68,.8);} }
    .heatchip { border:none; border-radius:999px; padding:6px 12px; font-weight:700; font-size:13px; cursor:pointer; color:#fff; }
    .heatchip.dim { background:rgba(255,255,255,.14); opacity:.7; }
    .heatchip.lit { background:rgba(239,68,68,.30); box-shadow:0 0 12px rgba(239,68,68,.5); }
    .heatchip.firing { background:rgba(239,68,68,.6); animation: flicker .45s infinite alternate; }
    @keyframes flicker { from { opacity:.7; transform:scale(.97);} to { opacity:1; transform:scale(1.04);} }
```

- [ ] **Step 2: Add the heater toggle handler** in `public/app.js`. After the `extendYard` function (around line 91), add:
```javascript
function toggleHeater(currentlyEnabled) {
  // Enabling confirms (costly); disabling is instant.
  if (!currentlyEnabled && !confirming.has('poolHeater')) { confirming.add('poolHeater'); render(lastStatus); return; }
  confirming.delete('poolHeater');
  const desired = !currentlyEnabled;
  pending.set('poolHeater', { on: desired, ts: Date.now() });
  render(lastStatus);
  postCommand({ action: 'heatmode', body: 'pool', enabled: desired }, 'poolHeater');
}

function heaterRow(s) {
  const enabled = pending.has('poolHeater') ? pending.get('poolHeater').on : !!s.pool.heatEnabled;
  const firing = !!s.pool.heaterOn;
  if (confirming.has('poolHeater')) {
    return `<div style="margin-top:12px;"><button class="cbtn confirm" data-act="heater" data-enabled="false">✓ Enable heater</button> <button class="cbtn cancel" data-act="cancelconfirm" data-role="poolHeater">Cancel</button></div>`;
  }
  const label = firing ? '🔥 Heating' : (enabled ? '🔥 Heater on' : '🔥 Heater off');
  const chipCls = `heatchip ${enabled ? 'lit' : 'dim'}${firing ? ' firing' : ''}`;
  return `<div style="margin-top:12px;"><button class="${chipCls}" data-act="heater" data-enabled="${enabled}">${label}</button></div>`;
}
```

- [ ] **Step 3: Render the heater on the Pool tile + the heating class.** In `bodyTile`, change the class line:
```javascript
  const cls = `tile ${on ? glowClass : 'off'}${isPending ? ' pending' : ''}`;
```
to:
```javascript
  const heating = role === 'pool' && !!s.pool.heaterOn;
  const cls = `tile ${heating ? 'heating' : (on ? glowClass : 'off')}${isPending ? ' pending' : ''}`;
```
And change the final return's setpoint block to append the heater row for the pool. Change:
```javascript
    <div style="margin-top:12px;"><span class="stepper"><button data-act="setdn" data-body="${body}" data-cur="${setVal}">−</button><b>${setVal}&deg;</b><button data-act="setup" data-body="${body}" data-cur="${setVal}">+</button></span>
      ${editing ? `<button class="cbtn confirm" data-act="applyset" data-body="${body}" style="margin-left:10px;">Apply ${setVal}&deg;</button>` : ''}</div>
  </div>`;
```
to:
```javascript
    <div style="margin-top:12px;"><span class="stepper"><button data-act="setdn" data-body="${body}" data-cur="${setVal}">−</button><b>${setVal}&deg;</b><button data-act="setup" data-body="${body}" data-cur="${setVal}">+</button></span>
      ${editing ? `<button class="cbtn confirm" data-act="applyset" data-body="${body}" style="margin-left:10px;">Apply ${setVal}&deg;</button>` : ''}</div>
    ${role === 'pool' ? heaterRow(s) : ''}
  </div>`;
```

- [ ] **Step 4: Wire the click + reconcile.** In the `viewControl` click delegation, add a `heater` case. Change:
```javascript
  if (act === 'toggle') toggleCircuit(el.dataset.role, el.dataset.name, el.dataset.on === 'true');
```
to:
```javascript
  if (act === 'toggle') toggleCircuit(el.dataset.role, el.dataset.name, el.dataset.on === 'true');
  else if (act === 'heater') toggleHeater(el.dataset.enabled === 'true');
```
Then update `reconcile` to special-case `poolHeater`. Replace the whole `reconcile` function with:
```javascript
function reconcile(s) {
  // Drop optimistic overrides once the gateway reflects them or after 10s.
  for (const [role, p] of pending) {
    let actual;
    if (role === 'poolHeater') {
      actual = !!s.pool?.heatEnabled;
    } else {
      const name = { pool: 'Pool', spa: 'Spa', spillway: 'Spillway', poolLight: 'Pool Light', spaLight: 'Spa Light', yardLight: 'Yard Light' }[role];
      const c = (s.circuits || []).find((x) => x.name?.toLowerCase() === name.toLowerCase());
      actual = c ? c.on : undefined;
    }
    if (actual === p.on || Date.now() - p.ts > 10000) pending.delete(role);
  }
}
```

- [ ] **Step 5: Confirm unit suite green**

Run: `npm test`
Expected: all pass (no backend change in this task).

- [ ] **Step 6: LIVE verification.** Stop any server (`pkill -f "node src/index.js" 2>/dev/null; sleep 1`), then `PORT=3210 node src/index.js &`, `sleep 8`:
  - Confirm the Pool heater starts disabled: `curl -s http://localhost:3210/status | node -e "const s=JSON.parse(require('fs').readFileSync(0));console.log('pool.heatEnabled:', s.pool.heatEnabled, '| heaterOn:', s.pool.heaterOn)"` → expect `false`/`false`.
  - Enable the heater **(pool is off, so gas will NOT fire — safe):** `curl -s -XPOST http://localhost:3210/api/command -H 'Content-Type: application/json' -d '{"action":"heatmode","body":"pool","enabled":true}'` → `{"ok":true}`; `sleep 6`; re-read status → `pool.heatEnabled: true` (and `heaterOn: false`, since the pool isn't running).
  - Disable to restore: POST `{"action":"heatmode","body":"pool","enabled":false}`; `sleep 6`; confirm `pool.heatEnabled: false`.
  - Reject check: POST `{"action":"heatmode","body":"pool","enabled":"yes"}` with `-o /dev/null -w "%{http_code}"` → `400`.
  - `kill <PID>`. Paste the before/after `heatEnabled` values and the 400.
  - Browser visual (the user's to confirm): the `🔥 Heater on/off` chip on the Pool tile, the inline `✓ Enable heater / Cancel` on enable, and — only when the heater actually fires (pool running + below setpoint) — the red flickering `🔥 Heating` tile. The red-flicker state can't be safely forced here (don't run the pool); it's driven by `heaterOn` and will show when it naturally fires.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: pool heater chip with enable-confirm and heating indicator"
```

---

## Verification Checklist (before done)

- [ ] `npm test` — all suites pass (incl. updated normalize + new server heatmode tests).
- [ ] Live: enabling/disabling the pool heater round-trips (`pool.heatEnabled` flips and restores); non-boolean `enabled` → 400.
- [ ] Pool tile shows `🔥 Heater on/off`; enable shows inline confirm; disable is instant.
- [ ] `heatEnabled` (mode) is distinct from `heaterOn` (actively firing); the red flicker is tied to `heaterOn`.
- [ ] Spa tile unchanged (no heater control).
