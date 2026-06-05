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
  const systemName = name.startsWith('Pentair: ') ? name : `Pentair: ${name}`;
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

export function getSystemTime(conn) {
  return conn.equipment.getSystemTimeAsync();
}

// Fetch both schedule types. scheduleType 0 = recurring, 1 = run-once.
export async function getSchedules(conn) {
  const recurring = await conn.schedule.getScheduleDataAsync(0);
  const runOnce = await conn.schedule.getScheduleDataAsync(1);
  return { recurring: recurring.data, runOnce: runOnce.data };
}

export function getPumpStatus(conn, pumpId) {
  return conn.pump.getPumpStatusAsync(pumpId);
}

export function setCircuitState(conn, circuitId, on) {
  return conn.circuits.setCircuitStateAsync(circuitId, on);
}

export function setSetPoint(conn, bodyIndex, temperatureF) {
  return conn.bodies.setSetPointAsync(bodyIndex, temperatureF);
}

export function setHeatMode(conn, bodyIndex, mode) {
  return conn.bodies.setHeatModeAsync(bodyIndex, mode);
}

// runtimeMinutes: one-time "egg timer" duration; circuit auto-offs after it elapses.
export function setCircuitRuntime(conn, circuitId, runtimeMinutes) {
  return conn.circuits.setCircuitRuntimebyIdAsync(circuitId, runtimeMinutes);
}

export async function close(conn) {
  try {
    await conn.closeAsync();
  } catch {
    // already closed / never opened — ignore on teardown
  }
}
