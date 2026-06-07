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

import { EventEmitter } from 'node:events';
import { normalizeStatus, normalizeSystemTime, normalizeSchedules, normalizePump } from './normalize.js';

export function createSession({ config, discover, adapter }) {
  const emitter = new EventEmitter();
  const baseDelayMs = config.baseDelayMs ?? 1000;
  const maxDelayMs = config.maxDelayMs ?? 30000;
  const configRefreshMs = config.configRefreshMs ?? 60000;

  let stopped = false;
  let pollTimer = null;
  let retryTimer = null;
  let conn = null;
  let gateway = null;
  let controllerConfig = null;
  let schedules = [];
  let lastConfigRefresh = 0;

  function backoff(attempt) {
    return Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  }

  // Guard: node:events `once()` registers a temporary 'error' listener, so
  // listenerCount('error') > 0 is true while once() is awaiting.  Emitting
  // 'error' during the retry loop would reject that promise immediately,
  // preventing 'status' from ever being awaited.  Transient connect failures
  // are emitted as 'connectError' instead; 'error' is reserved for unexpected
  // mid-poll failures after a successful connection.
  function emitConnectError(err) {
    if (emitter.listenerCount('connectError') > 0) emitter.emit('connectError', err);
  }

  function emitError(err) {
    if (emitter.listenerCount('error') > 0) emitter.emit('error', err);
  }

  // Controller config + schedules are cached at connect; periodically re-fetch them
  // (best-effort) so external edits — circuit renames/adds, schedule changes — show up
  // without a reconnect. Keep last-known values on failure.
  async function maybeRefreshConfig() {
    if (Date.now() - lastConfigRefresh < configRefreshMs) return;
    lastConfigRefresh = Date.now();
    try {
      controllerConfig = await adapter.getControllerConfig(conn);
      const raw = await adapter.getSchedules(conn);
      schedules = normalizeSchedules(raw.recurring, raw.runOnce, controllerConfig);
    } catch {
      // keep last-known config/schedules this cycle
    }
  }

  async function pollOnce() {
    const state = await adapter.getEquipmentState(conn);
    if (stopped) return;
    await maybeRefreshConfig();
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
    // Pump status is best-effort, like system time.
    try {
      const rawPump = await adapter.getPumpStatus(conn, config.pumpId);
      if (stopped) return;
      status.pump = normalizePump(rawPump, controllerConfig);
    } catch {
      // omit pump this cycle
    }
    emitter.emit('status', status);
  }

  function scheduleNextPoll() {
    if (stopped) return;
    pollTimer = setTimeout(async () => {
      try {
        await pollOnce();
        scheduleNextPoll();
      } catch (err) {
        emitError(err);
        teardownConn();
        startConnectLoop(); // lost the connection mid-poll → reconnect
      }
    }, config.pollIntervalMs);
  }

  function teardownConn() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
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
      // Schedules are best-effort: a fetch failure leaves them empty rather
      // than blocking the connection / live status.
      try {
        const raw = await adapter.getSchedules(conn);
        schedules = normalizeSchedules(raw.recurring, raw.runOnce, controllerConfig);
      } catch {
        schedules = [];
      }
      lastConfigRefresh = Date.now(); // start the periodic-refresh clock from connect
      emitter.emit('connected', gateway);
      await pollOnce();
      scheduleNextPoll();
    } catch (err) {
      emitConnectError(err);
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

  async function sendCommand(fn) {
    if (stopped || !conn) throw new Error('not connected');
    return fn(conn);
  }

  emitter.stop = stop;
  emitter.sendCommand = sendCommand;
  startConnectLoop();
  return emitter;
}
