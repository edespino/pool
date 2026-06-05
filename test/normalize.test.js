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
import { readFileSync } from 'node:fs';
import { normalizeStatus, normalizeSystemTime, normalizeSchedules, normalizePump } from '../src/normalize.js';

const config = JSON.parse(readFileSync(new URL('./fixtures/controllerConfig.json', import.meta.url)));
const state = JSON.parse(readFileSync(new URL('./fixtures/equipmentState.json', import.meta.url)));

test('maps air temperature', () => {
  const s = normalizeStatus(config, state);
  assert.equal(s.air.tempF, 78);
});

test('maps pool (body id 1) and spa (body id 2) with heater status', () => {
  const s = normalizeStatus(config, state);
  assert.deepEqual(s.pool, { tempF: 65, setpointF: 84, heaterOn: false, heatEnabled: false });
  assert.deepEqual(s.spa, { tempF: 102, setpointF: 102, heaterOn: true, heatEnabled: true });
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

test('falls back to "Circuit <id>" when config has no name for the circuit', () => {
  const s = normalizeStatus(config, { ...state, circuitArray: [{ id: 999, state: 1 }] });
  assert.deepEqual(s.circuits, [{ id: 999, name: 'Circuit 999', on: true }]);
});

test('normalizeStatus hides Aux* and Feature* circuits', () => {
  const cfg = {
    circuitArray: [
      { circuitId: 1, name: 'Spa' },
      { circuitId: 2, name: 'Pool Light' },
      { circuitId: 3, name: 'Aux 6' },
      { circuitId: 4, name: 'AuxEx' },
      { circuitId: 5, name: 'Feature 1' },
    ],
  };
  const state = {
    airTemp: 70,
    bodies: [],
    circuitArray: [
      { id: 1, state: 1 },
      { id: 2, state: 0 },
      { id: 3, state: 0 },
      { id: 4, state: 0 },
      { id: 5, state: 1 },
    ],
    pH: 0,
  };
  const s = normalizeStatus(cfg, state);
  assert.deepEqual(s.circuits, [
    { id: 1, name: 'Spa', on: true },
    { id: 2, name: 'Pool Light', on: false },
  ]);
});

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
    { id: 1, type: 'recurring', circuit: 'Pool',       start: '9:00 AM',  stop: '1:00 PM',  days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
    { id: 2, type: 'recurring', circuit: 'Cleaner',    start: '9:30 AM',  stop: '11:30 AM', days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
    { id: 4, type: 'recurring', circuit: 'Yard Light', start: '9:00 PM',  stop: '12:30 AM', days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
  ]);
});

test('normalizeSchedules tags run-once entries and falls back on unknown circuit', () => {
  const recurring = [];
  const runOnce = [{ scheduleId: 9, circuitId: 99, startTime: '0700', stopTime: '0800', days: ['Mon'] }];
  const result = normalizeSchedules(recurring, runOnce, scheduleConfig);
  assert.deepEqual(result, [
    { id: 9, type: 'run-once', circuit: 'Circuit 99', start: '7:00 AM', stop: '8:00 AM', days: ['Mon'] },
  ]);
});

test('normalizeSchedules returns [] for empty input', () => {
  assert.deepEqual(normalizeSchedules([], [], scheduleConfig), []);
});

test('normalizeSchedules formats noon and midnight correctly', () => {
  const recurring = [
    { scheduleId: 10, circuitId: 6, startTime: '1200', stopTime: '0000', days: [] },
  ];
  const result = normalizeSchedules(recurring, [], scheduleConfig);
  assert.equal(result[0].start, '12:00 PM');
  assert.equal(result[0].stop, '12:00 AM');
});

test('normalizeStatus derives heatEnabled from heatMode (0 = off)', () => {
  const cfg = { circuitArray: [] };
  const base = { airTemp: 70, circuitArray: [], pH: 0 };
  const off = normalizeStatus(cfg, { ...base, bodies: [{ id: 1, currentTemp: 80, setPoint: 85, heatStatus: 0, heatMode: 0 }] });
  assert.equal(off.pool.heatEnabled, false);
  const on = normalizeStatus(cfg, { ...base, bodies: [{ id: 1, currentTemp: 80, setPoint: 85, heatStatus: 0, heatMode: 3 }] });
  assert.equal(on.pool.heatEnabled, true);
});

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
  ]);
});

test('normalizePump maps live telemetry and unknown pump types', () => {
  const p = normalizePump({ pumpType: 99, isRunning: true, pumpRPMs: 2600, pumpWatts: 850, pumpGPMs: 60, pumpCircuits: [] }, { circuitArray: [] });
  assert.equal(p.model, 'Pump (type 99)');
  assert.deepEqual({ running: p.running, rpm: p.rpm, watts: p.watts, gpm: p.gpm }, { running: true, rpm: 2600, watts: 850, gpm: 60 });
  assert.deepEqual(p.presets, []);
});

test('normalizePump reports a stopped pump as not running despite a false-positive isRunning', () => {
  // Real EE-59-51 off-frame: isRunning true but rpm/watts 0 and gpm 255 (0xFF sentinel).
  const p = normalizePump({ pumpType: 3, isRunning: true, pumpRPMs: 0, pumpWatts: 0, pumpGPMs: 255, pumpCircuits: [] }, { circuitArray: [] });
  assert.equal(p.running, false);
});

test('normalizePump treats gpm 255 (0xFF, no flow sensor) as unknown (null)', () => {
  // Real EE-59-51 running-frame: rpm/watts real, but gpm stays 255 (no flow sensor).
  const p = normalizePump({ pumpType: 3, isRunning: true, pumpRPMs: 2600, pumpWatts: 1095, pumpGPMs: 255, pumpCircuits: [] }, { circuitArray: [] });
  assert.equal(p.running, true);
  assert.equal(p.rpm, 2600);
  assert.equal(p.watts, 1095);
  assert.equal(p.gpm, null);
});
