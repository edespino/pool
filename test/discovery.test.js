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
import { discoverGateway } from '../src/discovery.js';

const cfg = { gatewayName: 'EE-59-51', gatewayIp: null, gatewayPort: 80, discoveryTimeoutMs: 5000 };

test('locks onto the named gateway among multiple responders', async () => {
  const findUnits = async () => [
    { address: '192.168.1.10', port: 80, gatewayName: 'Pentair: AA-00-00' },
    { address: '192.168.1.20', port: 80, gatewayName: 'Pentair: EE-59-51' },
  ];
  const result = await discoverGateway(cfg, findUnits);
  assert.deepEqual(result, {
    ip: '192.168.1.20', port: 80, name: 'EE-59-51', via: 'broadcast',
  });
});

test('falls back to configured IP when broadcast finds nothing', async () => {
  const findUnits = async () => [];
  const result = await discoverGateway(
    { ...cfg, gatewayIp: '192.168.1.99', gatewayPort: 6680 },
    findUnits,
  );
  assert.deepEqual(result, {
    ip: '192.168.1.99', port: 6680, name: 'EE-59-51', via: 'configured-ip',
  });
});

test('throws when broadcast finds nothing and no fallback IP is set', async () => {
  const findUnits = async () => [];
  await assert.rejects(() => discoverGateway(cfg, findUnits), /could not locate/i);
});
