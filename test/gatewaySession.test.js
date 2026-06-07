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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createSession } from '../src/gatewaySession.js';

function deps(overrides = {}) {
  const calls = { connects: 0 };
  return {
    config: { pollIntervalMs: 5, baseDelayMs: 1, maxDelayMs: 8, pumpId: 1 },
    discover: async () => ({ ip: '1.2.3.4', port: 80, name: 'EE-59-51', via: 'broadcast' }),
    adapter: {
      connect: async () => { calls.connects += 1; return { id: 'conn' }; },
      getControllerConfig: async () => ({ circuitArray: [{ circuitId: 500, name: 'Pool' }] }),
      getEquipmentState: async () => ({ airTemp: 80, bodies: [], circuitArray: [{ id: 500, state: 1 }], pH: 0 }),
      getSystemTime: async () => ({ year: 2026, month: 6, day: 4, hour: 0, minute: 25, second: 0, adjustForDST: true }),
      getSchedules: async () => ({ recurring: [{ scheduleId: 1, circuitId: 500, startTime: '0900', stopTime: '1300', days: ['Mon'] }], runOnce: [] }),
      getPumpStatus: async () => ({ pumpType: 3, isRunning: false, pumpRPMs: 0, pumpWatts: 0, pumpGPMs: 0, pumpCircuits: [{ circuitId: 500, speed: 2600, isRPMs: true }] }),
      close: async () => {},
    },
    calls,
    ...overrides,
  };
}

// Create a session and guarantee it's stopped after the test — even if an assertion
// throws first. Without this, a failed test leaks the session's poll timer and hangs
// the test runner (an idle event loop that never exits).
function startSession(t, d) {
  const session = createSession(d);
  t.after(() => session.stop());
  return session;
}

test('emits a normalized status after connecting', async (t) => {
  const d = deps();
  const session = startSession(t, d);
  const [status] = await once(session, 'status');
  assert.equal(status.air.tempF, 80);
  assert.equal(status.gateway.connected, true);
  assert.equal(status.gateway.name, 'EE-59-51');
  assert.deepEqual(status.circuits, [{ id: 500, name: 'Pool', on: true }]);
  assert.deepEqual(status.systemTime, { clock: '2026-06-04 00:25', adjustForDST: true });
  assert.deepEqual(status.schedules, [
    { id: 1, type: 'recurring', circuit: 'Pool', start: '9:00 AM', stop: '1:00 PM', days: ['Mon'] },
  ]);
  assert.equal(status.pump.model, 'IntelliFlo VS');
  assert.deepEqual(status.pump.presets, [{ circuitId: 500, circuit: 'Pool', rpm: 2600 }]);
});

test('reconnects after a connect failure and eventually emits status', async (t) => {
  const d = deps();
  let fail = 2;
  d.adapter.connect = async () => {
    if (fail-- > 0) throw new Error('connection refused');
    return { id: 'conn' };
  };
  const session = startSession(t, d);
  const [status] = await once(session, 'status');
  assert.equal(status.air.tempF, 80);
});

test('stop() halts polling and emits no further status', async (t) => {
  const d = deps();
  const session = startSession(t, d);
  await once(session, 'status');
  session.stop();
  let fired = false;
  session.on('status', () => { fired = true; });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fired, false);
});

test('recovers from a mid-poll failure by reconnecting', async (t) => {
  const d = deps();
  let poll = 0;
  d.adapter.getEquipmentState = async () => {
    poll += 1;
    if (poll === 2) throw new Error('poll failed');
    return { airTemp: 80, bodies: [], circuitArray: [{ id: 500, state: 1 }], pH: 0 };
  };
  const session = startSession(t, d);
  session.on('error', () => {}); // mid-poll failure emits 'error'; absorb it
  await once(session, 'status');           // first poll succeeds
  const before = d.calls.connects;
  const status = await new Promise((resolve) => session.on('status', resolve));
  assert.equal(status.air.tempF, 80);      // emitted again after reconnect
  assert.ok(d.calls.connects > before);    // a new connection was established
});

test('schedule fetch failure leaves schedules empty but still emits status', async (t) => {
  const d = deps();
  d.adapter.getSchedules = async () => { throw new Error('no schedules'); };
  const session = startSession(t, d);
  const [status] = await once(session, 'status');
  assert.deepEqual(status.schedules, []);
  assert.equal(status.air.tempF, 80);
});

test('system-time failure omits systemTime but still emits status', async (t) => {
  const d = deps();
  d.adapter.getSystemTime = async () => { throw new Error('no time'); };
  const session = startSession(t, d);
  const [status] = await once(session, 'status');
  assert.equal(status.systemTime, undefined);
  assert.equal(status.air.tempF, 80);
});

test('sendCommand runs the fn on the live connection when connected', async (t) => {
  const d = deps();
  let received = null;
  const session = startSession(t, d);
  await once(session, 'status'); // now connected
  const result = await session.sendCommand((conn) => { received = conn; return 'ok'; });
  assert.equal(result, 'ok');
  assert.deepEqual(received, { id: 'conn' });
});

test('sendCommand rejects when not connected', async (t) => {
  const d = deps();
  const session = startSession(t, d); // connect is async; conn not established yet
  await assert.rejects(() => session.sendCommand(() => 'x'), /not connected/i);
});

test('periodically re-fetches config + schedules so external edits appear without reconnect', async (t) => {
  const d = deps();
  d.config.configRefreshMs = 1; // refresh on essentially every poll
  let circuitName = 'Pool';
  let startTime = '0900';
  d.adapter.getControllerConfig = async () => ({ circuitArray: [{ circuitId: 500, name: circuitName }] });
  d.adapter.getSchedules = async () => ({ recurring: [{ scheduleId: 1, circuitId: 500, startTime, stopTime: '1300', days: ['Mon'] }], runOnce: [] });
  const session = startSession(t, d);
  const [first] = await once(session, 'status');
  assert.equal(first.circuits[0].name, 'Pool');
  assert.equal(first.schedules[0].start, '9:00 AM');
  const beforeConnects = d.calls.connects;

  // Simulate external edits in the ScreenLogic app (rename a circuit, change a schedule).
  circuitName = 'Pool Pump';
  startTime = '0800';
  const updated = await Promise.race([
    new Promise((resolve) => {
      function onStatus(s) {
        if (s.circuits[0]?.name === 'Pool Pump' && s.schedules[0]?.start === '8:00 AM') {
          session.off('status', onStatus);
          resolve(s);
        }
      }
      session.on('status', onStatus);
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('config/schedules did not refresh')), 500)),
  ]);
  assert.equal(updated.circuits[0].name, 'Pool Pump');
  assert.equal(updated.schedules[0].start, '8:00 AM');
  assert.equal(d.calls.connects, beforeConnects, 'must refresh in-place, no reconnect');
});

test('pump-status failure omits pump but still emits status', async (t) => {
  const d = deps();
  d.adapter.getPumpStatus = async () => { throw new Error('no pump'); };
  const session = startSession(t, d);
  const [status] = await once(session, 'status');
  assert.equal(status.pump, undefined);
  assert.equal(status.air.tempF, 80);
});
