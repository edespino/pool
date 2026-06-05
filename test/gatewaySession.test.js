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

test('emits a normalized status after connecting', async () => {
  const d = deps();
  const session = createSession(d);
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

test('recovers from a mid-poll failure by reconnecting', async () => {
  const d = deps();
  let poll = 0;
  d.adapter.getEquipmentState = async () => {
    poll += 1;
    if (poll === 2) throw new Error('poll failed');
    return { airTemp: 80, bodies: [], circuitArray: [{ id: 500, state: 1 }], pH: 0 };
  };
  const session = createSession(d);
  session.on('error', () => {}); // mid-poll failure emits 'error'; absorb it
  await once(session, 'status');           // first poll succeeds
  const before = d.calls.connects;
  const status = await new Promise((resolve) => session.on('status', resolve));
  assert.equal(status.air.tempF, 80);      // emitted again after reconnect
  assert.ok(d.calls.connects > before);    // a new connection was established
  session.stop();
});

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

test('sendCommand runs the fn on the live connection when connected', async () => {
  const d = deps();
  let received = null;
  const session = createSession(d);
  await once(session, 'status'); // now connected
  const result = await session.sendCommand((conn) => { received = conn; return 'ok'; });
  assert.equal(result, 'ok');
  assert.deepEqual(received, { id: 'conn' });
  session.stop();
});

test('sendCommand rejects when not connected', async () => {
  const d = deps();
  const session = createSession(d); // connect is async; conn not established yet
  await assert.rejects(() => session.sendCommand(() => 'x'), /not connected/i);
  session.stop();
});

test('pump-status failure omits pump but still emits status', async () => {
  const d = deps();
  d.adapter.getPumpStatus = async () => { throw new Error('no pump'); };
  const session = createSession(d);
  const [status] = await once(session, 'status');
  assert.equal(status.pump, undefined);
  assert.equal(status.air.tempF, 80);
  session.stop();
});
