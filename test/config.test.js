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
import { loadConfig } from '../src/config.js';

test('loadConfig applies defaults when env is empty', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.gatewayName, 'EE-59-51');
  assert.equal(cfg.gatewayIp, null);
  assert.equal(cfg.gatewayPort, 80);
  assert.equal(cfg.gatewayPassword, '');
  assert.equal(cfg.pollIntervalMs, 5000);
  assert.equal(cfg.discoveryTimeoutMs, 5000);
  assert.equal(cfg.webPort, 3000);
  assert.equal(cfg.pumpId, 1);
});

test('loadConfig reads overrides and coerces numbers', () => {
  const cfg = loadConfig({
    POOL_GATEWAY_NAME: 'AB-12-34',
    POOL_GATEWAY_IP: '192.168.1.50',
    POOL_GATEWAY_PORT: '6680',
    POOL_GATEWAY_PASSWORD: 'secret',
    POLL_INTERVAL_MS: '2000',
    DISCOVERY_TIMEOUT_MS: '3000',
    PORT: '8080',
    POOL_PUMP_ID: '2',
  });
  assert.equal(cfg.gatewayName, 'AB-12-34');
  assert.equal(cfg.gatewayIp, '192.168.1.50');
  assert.equal(cfg.gatewayPort, 6680);
  assert.equal(cfg.gatewayPassword, 'secret');
  assert.equal(cfg.pollIntervalMs, 2000);
  assert.equal(cfg.discoveryTimeoutMs, 3000);
  assert.equal(cfg.webPort, 8080);
  assert.equal(cfg.pumpId, 2);
});

test('loadConfig falls back to defaults for non-numeric values', () => {
  const cfg = loadConfig({ POOL_GATEWAY_PORT: 'bad', POLL_INTERVAL_MS: '', PORT: 'xyz' });
  assert.equal(cfg.gatewayPort, 80);
  assert.equal(cfg.pollIntervalMs, 5000);
  assert.equal(cfg.webPort, 3000);
});
