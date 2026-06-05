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

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveRole } from './circuitRoles.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const BODY_INDEX = { pool: 0, spa: 1 }; // BodyIndex enum: POOL=0, SPA=1
const SETPOINT_MIN = 40;
const SETPOINT_MAX = 104;

export function createServer(session, adapter) {
  const app = express();
  app.use(express.json());
  let lastStatus = null;
  const clients = new Set();

  session.on('status', (status) => {
    lastStatus = status;
    const payload = `data: ${JSON.stringify(status)}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
  });

  app.get('/status', (req, res) => {
    if (!lastStatus) return res.status(503).json({ error: 'no status yet' });
    res.json(lastStatus);
  });

  app.get('/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    clients.add(res);
    if (lastStatus) res.write(`data: ${JSON.stringify(lastStatus)}\n\n`);
    req.on('close', () => clients.delete(res));
  });

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
        if (!Number.isFinite(body.tempF) || body.tempF < SETPOINT_MIN || body.tempF > SETPOINT_MAX) {
          return res.status(400).json({ error: 'setpoint out of range' });
        }
        await session.sendCommand((conn) => adapter.setSetPoint(conn, bodyIndex, body.tempF));
        return res.json({ ok: true });
      }
      if (body.action === 'extend') {
        const id = resolveRole(body.role, circuits);
        if (id == null) return res.status(400).json({ error: 'unknown circuit role' });
        if (!Number.isFinite(body.minutes) || body.minutes <= 0 || body.minutes > 240) {
          return res.status(400).json({ error: 'minutes out of range' });
        }
        await session.sendCommand((conn) => adapter.setCircuitRuntime(conn, id, body.minutes));
        return res.json({ ok: true });
      }
      if (body.action === 'heatmode') {
        const bodyIndex = BODY_INDEX[body.body];
        if (bodyIndex === undefined) return res.status(400).json({ error: 'unknown body' });
        if (typeof body.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });
        await session.sendCommand((conn) => adapter.setHeatMode(conn, bodyIndex, body.enabled ? 3 : 0));
        return res.json({ ok: true });
      }
      return res.status(400).json({ error: 'unknown action' });
    } catch (err) {
      const code = /not connected/i.test(err.message) ? 503 : 502;
      return res.status(code).json({ error: err.message });
    }
  });

  app.use(express.static(publicDir));
  return app;
}
