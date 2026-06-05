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
  // supertest custom parsers populate res.body, not res.text
  assert.match(res.body, /data: .*77/);
});

function fakeAdapter() {
  const calls = [];
  return {
    calls,
    setCircuitState: (conn, id, on) => { calls.push(['circuit', id, on]); return Promise.resolve(); },
    setSetPoint: (conn, body, t) => { calls.push(['setpoint', body, t]); return Promise.resolve(); },
    setCircuitRuntime: (conn, id, m) => { calls.push(['runtime', id, m]); return Promise.resolve(); },
    setHeatMode: (conn, bi, mode) => { calls.push(['heatmode', bi, mode]); return Promise.resolve(); },
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

test('POST /api/command extends a circuit runtime by role', async () => {
  const session = connectedSession();
  const adapter = fakeAdapter();
  const app = createServer(session, adapter);
  session.emit('status', { circuits: [{ id: 5, name: 'Yard Light', on: false }], gateway: {} });

  const res = await request(app).post('/api/command').send({ action: 'extend', role: 'yardLight', minutes: 30 });
  assert.equal(res.status, 200);
  assert.deepEqual(adapter.calls, [['runtime', 5, 30]]);
});

test('POST /api/command rejects bad extend minutes (0, 241, NaN-ish)', async () => {
  const session = connectedSession();
  const app = createServer(session, fakeAdapter());
  session.emit('status', { circuits: [{ id: 5, name: 'Yard Light', on: false }], gateway: {} });

  assert.equal((await request(app).post('/api/command').send({ action: 'extend', role: 'yardLight', minutes: 0 })).status, 400);
  assert.equal((await request(app).post('/api/command').send({ action: 'extend', role: 'yardLight', minutes: 241 })).status, 400);
});

test('POST /api/command rejects a non-finite setpoint', async () => {
  const session = connectedSession();
  const app = createServer(session, fakeAdapter());
  session.emit('status', { circuits: [], gateway: {} });
  // JSON can't carry NaN, but null/strings must be rejected by the finite guard.
  assert.equal((await request(app).post('/api/command').send({ action: 'setpoint', body: 'pool', tempF: null })).status, 400);
  assert.equal((await request(app).post('/api/command').send({ action: 'setpoint', body: 'pool', tempF: '90' })).status, 400);
});

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
