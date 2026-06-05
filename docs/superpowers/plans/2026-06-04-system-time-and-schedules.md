# System Time & Schedules Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only display of the gateway's system time (in the header, refreshed each poll) and its schedules (as a card) to the existing Pentair pool dashboard.

**Architecture:** Extends the existing read-only pipeline. The gateway session fetches schedules once per connection and the system time on every poll, both best-effort, and attaches them to the status object pushed over SSE. Two new pure normalizers and two new adapter wrappers; the SSE server is untouched.

**Tech Stack:** Node.js (ESM), node-screenlogic 2.1.1, Express + SSE, vanilla JS frontend, Node's built-in `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-04-system-time-and-schedules-design.md`

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/slAdapter.js` | modify | Add `getSystemTime(conn)` and `getSchedules(conn)` wrappers (only file importing node-screenlogic) |
| `src/normalize.js` | modify | Add `normalizeSystemTime` + `normalizeSchedules`; extract a shared `circuitNames` helper reused by `normalizeStatus` |
| `src/gatewaySession.js` | modify | Fetch schedules once at connect (best-effort) + system time per poll (best-effort); attach both to status |
| `public/index.html` | modify | Add a header span for the controller clock |
| `public/app.js` | modify | Render controller clock in header + a Schedules card |
| `test/normalize.test.js` | modify | Tests for the two new normalizers |
| `test/gatewaySession.test.js` | modify | Update injected adapter fake; assert systemTime/schedules + best-effort behavior |
| `test/fixtures/systemTime.json` | create | Real-shaped raw system-time payload |
| `test/fixtures/schedules.json` | create | Real captured schedule payload |

---

### Task 1: Adapter wrappers for system time and schedules

`src/slAdapter.js` is the only file importing node-screenlogic. Add two thin wrappers. Not unit-tested (pure I/O) — verified by a load check now and live in Task 5.

**Files:**
- Modify: `src/slAdapter.js`

- [ ] **Step 1: Add the two wrappers**

In `src/slAdapter.js`, after the existing `getEquipmentState` function (before `close`), add:

```javascript
export function getSystemTime(conn) {
  return conn.equipment.getSystemTimeAsync();
}

// Fetch both schedule types. scheduleType 0 = recurring, 1 = run-once.
export async function getSchedules(conn) {
  const recurring = await conn.schedule.getScheduleDataAsync(0);
  const runOnce = await conn.schedule.getScheduleDataAsync(1);
  return { recurring: recurring.data, runOnce: runOnce.data };
}
```

- [ ] **Step 2: Verify the module still loads and exports the new names**

Run: `node -e "import('./src/slAdapter.js').then(m => console.log(Object.keys(m).sort()))"`
Expected: array includes `getSchedules` and `getSystemTime` alongside `close`, `connect`, `findUnits`, `getControllerConfig`, `getEquipmentState`. Do NOT attempt a live connection here.

- [ ] **Step 3: Commit**

```bash
git add src/slAdapter.js
git commit -m "feat: adapter wrappers for system time and schedules"
```

---

### Task 2: normalizeSystemTime

**Files:**
- Create: `test/fixtures/systemTime.json`
- Modify: `src/normalize.js`
- Modify: `test/normalize.test.js`

- [ ] **Step 1: Create the fixture**

`test/fixtures/systemTime.json` (real-shaped; `hour:0` exercises zero-padding):
```json
{
  "year": 2026,
  "month": 6,
  "day": 4,
  "dayOfWeek": 4,
  "hour": 0,
  "minute": 25,
  "second": 58,
  "millisecond": 0,
  "adjustForDST": true
}
```

- [ ] **Step 2: Write the failing test**

Append to `test/normalize.test.js` (the file already imports `test`, `assert`, `readFileSync`; add the new import and a fixture load near the top imports — see Step 4 for the import line). Add these tests at the end of the file:
```javascript
test('normalizeSystemTime builds a zero-padded clock string', () => {
  const raw = JSON.parse(readFileSync(new URL('./fixtures/systemTime.json', import.meta.url)));
  const t = normalizeSystemTime(raw);
  assert.deepEqual(t, { clock: '2026-06-04 00:25', adjustForDST: true });
});

test('normalizeSystemTime zero-pads single-digit month, day, hour, minute', () => {
  const t = normalizeSystemTime({ year: 2026, month: 3, day: 7, hour: 9, minute: 5, adjustForDST: false });
  assert.equal(t.clock, '2026-03-07 09:05');
  assert.equal(t.adjustForDST, false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/normalize.test.js`
Expected: FAIL — `normalizeSystemTime is not defined` (or import error after Step 4 is added). If you add the import in Step 4 first, the failure is `normalizeSystemTime is not a function`.

- [ ] **Step 4: Add the import for the new function**

At the top of `test/normalize.test.js`, change the existing import line:
```javascript
import { normalizeStatus } from '../src/normalize.js';
```
to:
```javascript
import { normalizeStatus, normalizeSystemTime } from '../src/normalize.js';
```

- [ ] **Step 5: Implement `normalizeSystemTime`**

In `src/normalize.js`, add this exported function at the end of the file:
```javascript
export function normalizeSystemTime(raw) {
  const p = (n) => String(n).padStart(2, '0');
  return {
    clock: `${raw.year}-${p(raw.month)}-${p(raw.day)} ${p(raw.hour)}:${p(raw.minute)}`,
    adjustForDST: raw.adjustForDST,
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/normalize.test.js`
Expected: PASS (existing normalize tests + the two new ones).

- [ ] **Step 7: Commit**

```bash
git add src/normalize.js test/normalize.test.js test/fixtures/systemTime.json
git commit -m "feat: normalizeSystemTime"
```

---

### Task 3: normalizeSchedules (+ shared circuitNames helper)

`normalizeStatus` and `normalizeSchedules` both need the `circuitId → name` map. Extract a shared helper to keep it DRY.

**Files:**
- Create: `test/fixtures/schedules.json`
- Modify: `src/normalize.js`
- Modify: `test/normalize.test.js`

- [ ] **Step 1: Create the fixture (real captured data)**

`test/fixtures/schedules.json`:
```json
{
  "recurring": [
    { "scheduleId": 1, "circuitId": 6, "startTime": "0900", "stopTime": "1300", "dayMask": 127, "flags": 0, "heatCmd": 4, "heatSetPoint": 70, "days": ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] },
    { "scheduleId": 2, "circuitId": 2, "startTime": "0930", "stopTime": "1130", "dayMask": 127, "flags": 0, "heatCmd": 4, "heatSetPoint": 70, "days": ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] },
    { "scheduleId": 4, "circuitId": 5, "startTime": "2100", "stopTime": "0030", "dayMask": 127, "flags": 0, "heatCmd": 4, "heatSetPoint": 70, "days": ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] }
  ],
  "runOnce": []
}
```

- [ ] **Step 2: Write the failing tests**

Add to `test/normalize.test.js` (update the import in Step 4):
```javascript
const scheduleConfig = {
  circuitArray: [
    { circuitId: 6, name: 'Pool' },
    { circuitId: 2, name: 'Cleaner' },
    { circuitId: 5, name: 'Yard Light' },
  ],
};

test('normalizeSchedules joins circuit names and formats times', () => {
  const raw = JSON.parse(readFileSync(new URL('./fixtures/schedules.json', import.meta.url)));
  const result = normalizeSchedules(raw.recurring, raw.runOnce, scheduleConfig);
  assert.deepEqual(result, [
    { id: 1, type: 'recurring', circuit: 'Pool',       start: '09:00', stop: '13:00', days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
    { id: 2, type: 'recurring', circuit: 'Cleaner',    start: '09:30', stop: '11:30', days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
    { id: 4, type: 'recurring', circuit: 'Yard Light', start: '21:00', stop: '00:30', days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
  ]);
});

test('normalizeSchedules tags run-once entries and falls back on unknown circuit', () => {
  const recurring = [];
  const runOnce = [{ scheduleId: 9, circuitId: 99, startTime: '0700', stopTime: '0800', days: ['Mon'] }];
  const result = normalizeSchedules(recurring, runOnce, scheduleConfig);
  assert.deepEqual(result, [
    { id: 9, type: 'run-once', circuit: 'Circuit 99', start: '07:00', stop: '08:00', days: ['Mon'] },
  ]);
});

test('normalizeSchedules returns [] for empty input', () => {
  assert.deepEqual(normalizeSchedules([], [], scheduleConfig), []);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/normalize.test.js`
Expected: FAIL — `normalizeSchedules is not a function` (after the import is added) or not defined.

- [ ] **Step 4: Update the import**

In `test/normalize.test.js`, change:
```javascript
import { normalizeStatus, normalizeSystemTime } from '../src/normalize.js';
```
to:
```javascript
import { normalizeStatus, normalizeSystemTime, normalizeSchedules } from '../src/normalize.js';
```

- [ ] **Step 5: Implement the helper + normalizeSchedules, refactor normalizeStatus to reuse the helper**

In `src/normalize.js`:

(a) Add the shared helper and a time formatter near the top (after the `BODY_LABELS` line):
```javascript
function circuitNames(controllerConfig) {
  return new Map((controllerConfig.circuitArray ?? []).map((c) => [c.circuitId, c.name]));
}

function formatHHMM(t) {
  const s = String(t).padStart(4, '0');
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
}
```

(b) In `normalizeStatus`, replace the inline name-map construction:
```javascript
  const names = new Map(
    (controllerConfig.circuitArray ?? []).map((c) => [c.circuitId, c.name]),
  );
```
with:
```javascript
  const names = circuitNames(controllerConfig);
```

(c) Add the exported `normalizeSchedules` at the end of the file:
```javascript
export function normalizeSchedules(recurring = [], runOnce = [], controllerConfig = {}) {
  const names = circuitNames(controllerConfig);
  const mapList = (list, type) =>
    list.map((s) => ({
      id: s.scheduleId,
      type,
      circuit: names.get(s.circuitId) ?? `Circuit ${s.circuitId}`,
      start: formatHHMM(s.startTime),
      stop: formatHHMM(s.stopTime),
      days: s.days ?? [],
    }));
  return [...mapList(recurring, 'recurring'), ...mapList(runOnce, 'run-once')];
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/normalize.test.js`
Expected: PASS (all normalize tests, including the unchanged `normalizeStatus` tests — confirming the helper refactor didn't break them).

- [ ] **Step 7: Commit**

```bash
git add src/normalize.js test/normalize.test.js test/fixtures/schedules.json
git commit -m "feat: normalizeSchedules and shared circuitNames helper"
```

---

### Task 4: Wire system time + schedules into the gateway session

Fetch schedules once at connect (best-effort) and system time each poll (best-effort), attaching both to the emitted status. `getEquipmentState` remains the only connection-health signal.

**Files:**
- Modify: `src/gatewaySession.js`
- Modify: `test/gatewaySession.test.js`

- [ ] **Step 1: Update the test fixture deps and add the failing assertions/tests**

In `test/gatewaySession.test.js`, update the `deps()` adapter to include the two new methods. Change the `adapter` object inside `deps()` from:
```javascript
    adapter: {
      connect: async () => { calls.connects += 1; return { id: 'conn' }; },
      getControllerConfig: async () => ({ circuitArray: [{ circuitId: 500, name: 'Pool' }] }),
      getEquipmentState: async () => ({ airTemp: 80, bodies: [], circuitArray: [{ id: 500, state: 1 }], pH: 0 }),
      close: async () => {},
    },
```
to:
```javascript
    adapter: {
      connect: async () => { calls.connects += 1; return { id: 'conn' }; },
      getControllerConfig: async () => ({ circuitArray: [{ circuitId: 500, name: 'Pool' }] }),
      getEquipmentState: async () => ({ airTemp: 80, bodies: [], circuitArray: [{ id: 500, state: 1 }], pH: 0 }),
      getSystemTime: async () => ({ year: 2026, month: 6, day: 4, hour: 0, minute: 25, second: 0, adjustForDST: true }),
      getSchedules: async () => ({ recurring: [{ scheduleId: 1, circuitId: 500, startTime: '0900', stopTime: '1300', days: ['Mon'] }], runOnce: [] }),
      close: async () => {},
    },
```

Then extend the first test (`'emits a normalized status after connecting'`) by adding these assertions before `session.stop();`:
```javascript
  assert.deepEqual(status.systemTime, { clock: '2026-06-04 00:25', adjustForDST: true });
  assert.deepEqual(status.schedules, [
    { id: 1, type: 'recurring', circuit: 'Pool', start: '09:00', stop: '13:00', days: ['Mon'] },
  ]);
```

And append two new tests for best-effort behavior:
```javascript
test('schedule fetch failure leaves schedules empty but still emits status', async () => {
  const d = deps();
  d.adapter.getSchedules = async () => { throw new Error('no schedules'); };
  const session = createSession(d);
  const [status] = await once(session, 'status');
  assert.deepEqual(status.schedules, []);
  assert.equal(status.air.tempF, 80);
  session.stop();
});

test('system-time failure omits systemTime but still emits status', async () => {
  const d = deps();
  d.adapter.getSystemTime = async () => { throw new Error('no time'); };
  const session = createSession(d);
  const [status] = await once(session, 'status');
  assert.equal(status.systemTime, undefined);
  assert.equal(status.air.tempF, 80);
  session.stop();
});
```

- [ ] **Step 2: Run tests to verify the new assertions fail**

Run: `node --test test/gatewaySession.test.js`
Expected: FAIL — the first test fails on `status.systemTime`/`status.schedules` being undefined (the session doesn't attach them yet).

- [ ] **Step 3: Implement the session changes**

In `src/gatewaySession.js`:

(a) Update the import:
```javascript
import { normalizeStatus } from './normalize.js';
```
to:
```javascript
import { normalizeStatus, normalizeSystemTime, normalizeSchedules } from './normalize.js';
```

(b) Add a `schedules` state variable. Change:
```javascript
  let conn = null;
  let gateway = null;
  let controllerConfig = null;
```
to:
```javascript
  let conn = null;
  let gateway = null;
  let controllerConfig = null;
  let schedules = [];
```

(c) Replace the `pollOnce` function:
```javascript
  async function pollOnce() {
    const state = await adapter.getEquipmentState(conn);
    if (stopped) return;
    const status = normalizeStatus(controllerConfig, state);
    status.gateway = {
      name: gateway.name, ip: gateway.ip, port: gateway.port,
      connected: true, lastUpdate: Date.now(),
    };
    emitter.emit('status', status);
  }
```
with:
```javascript
  async function pollOnce() {
    const state = await adapter.getEquipmentState(conn);
    if (stopped) return;
    const status = normalizeStatus(controllerConfig, state);
    status.gateway = {
      name: gateway.name, ip: gateway.ip, port: gateway.port,
      connected: true, lastUpdate: Date.now(),
    };
    status.schedules = schedules;
    // System time is best-effort: a transient failure omits it rather than
    // tearing down the connection (getEquipmentState is the health signal).
    try {
      const rawTime = await adapter.getSystemTime(conn);
      if (stopped) return;
      status.systemTime = normalizeSystemTime(rawTime);
    } catch {
      // omit systemTime this cycle
    }
    emitter.emit('status', status);
  }
```

(d) In `connectAttempt`, fetch schedules once after the controller config. Change:
```javascript
      controllerConfig = await adapter.getControllerConfig(conn);
      emitter.emit('connected', gateway);
```
to:
```javascript
      controllerConfig = await adapter.getControllerConfig(conn);
      // Schedules are best-effort: a fetch failure leaves them empty rather
      // than blocking the connection / live status.
      try {
        const raw = await adapter.getSchedules(conn);
        schedules = normalizeSchedules(raw.recurring, raw.runOnce, controllerConfig);
      } catch {
        schedules = [];
      }
      emitter.emit('connected', gateway);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/gatewaySession.test.js`
Expected: PASS — all gatewaySession tests (the original 4 plus the 2 new best-effort tests), with systemTime/schedules now present.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — config, discovery, normalize, gatewaySession, server all green.

- [ ] **Step 6: Commit**

```bash
git add src/gatewaySession.js test/gatewaySession.test.js
git commit -m "feat: attach system time (per poll) and schedules (per connection) to status"
```

---

### Task 5: Frontend — header clock + Schedules card, and live verification

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`

- [ ] **Step 1: Add a header span for the controller clock**

In `public/index.html`, change the header line:
```html
  <header><strong>Pool — EE-59-51</strong><span id="updated">—</span></header>
```
to:
```html
  <header><strong>Pool — EE-59-51</strong><span><span id="controller-time">—</span> &nbsp; updated <span id="updated">—</span></span></header>
```

- [ ] **Step 2: Render the clock and the Schedules card**

In `public/app.js`:

(a) Add a reference to the new element. Change:
```javascript
const updated = document.getElementById('updated');
```
to:
```javascript
const updated = document.getElementById('updated');
const controllerTime = document.getElementById('controller-time');
```

(b) In `render(s)`, add the Schedules card. Insert this block right after the `chemistry` block (before `cards.innerHTML = parts.join('');`):
```javascript
  if (s.schedules) {
    const rows = s.schedules.length
      ? s.schedules.map((sch) => {
          const days = sch.days?.length === 7 ? 'Every day' : (sch.days || []).join(' ');
          const tag = sch.type === 'run-once' ? ' <span class="off">once</span>' : '';
          return `<li><span>${sch.circuit}${tag}</span><span>${sch.start}–${sch.stop} · ${days}</span></li>`;
        }).join('')
      : '<li><span class="off">No schedules</span></li>';
    parts.push(`<div class="card"><h2>Schedules</h2><ul>${rows}</ul></div>`);
  }
```

(c) Update the header clock. Change:
```javascript
  if (s.gateway?.lastUpdate) updated.textContent = new Date(s.gateway.lastUpdate).toLocaleTimeString();
```
to:
```javascript
  if (s.gateway?.lastUpdate) updated.textContent = new Date(s.gateway.lastUpdate).toLocaleTimeString();
  if (s.systemTime?.clock) controllerTime.textContent = `Controller ${s.systemTime.clock.slice(11)}`;
```

- [ ] **Step 3: Confirm the unit suite is still green**

Run: `npm test`
Expected: PASS (frontend is not unit-tested; this just confirms nothing else broke).

- [ ] **Step 4: LIVE verification against the real gateway**

Start the server on a test port: `PORT=3210 node src/index.js &` (note the PID). Wait ~8 seconds for connect + first poll, then:

Run: `curl -s http://localhost:3210/status`
Expected: the JSON now includes a `"systemTime":{"clock":"YYYY-MM-DD HH:MM","adjustForDST":true}` field and a `"schedules":[ ... ]` array with real entries (Pool 09:00–13:00, Cleaner 09:30–11:30, Yard Light 21:00–00:30, each with `days` of 7 entries). Paste the literal `systemTime` and `schedules` portions.

Then open `http://localhost:3210` in a browser and confirm: the header shows `Controller HH:MM` (matching the gateway clock we corrected) and a **Schedules** card lists the three schedules as `Circuit  start–stop · Every day`.

Kill the server: `kill <PID>` (releases the gateway connection).

> If the live `systemTime`/`schedules` shapes differ from the fixtures (field names, time format), STOP and report — do not silently rewrite. They were captured from this exact gateway on 2026-06-04, so they should match.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: display controller clock in header and schedules card"
```

---

## Verification Checklist (run before declaring done)

- [ ] `npm test` — all suites pass (config, discovery, normalize, gatewaySession, server).
- [ ] `curl /status` on a live run includes `systemTime.clock` and a populated `schedules` array.
- [ ] Browser shows the controller clock in the header and a Schedules card with the three real schedules.
- [ ] Still read-only — no write/state-changing calls were added (no `set*` to the gateway).
