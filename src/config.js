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

function num(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env = process.env) {
  return {
    gatewayName: env.POOL_GATEWAY_NAME || 'EE-59-51',
    gatewayIp: env.POOL_GATEWAY_IP || null,
    gatewayPort: num(env.POOL_GATEWAY_PORT, 80),
    gatewayPassword: env.POOL_GATEWAY_PASSWORD || '',
    pollIntervalMs: num(env.POLL_INTERVAL_MS, 5000),
    discoveryTimeoutMs: num(env.DISCOVERY_TIMEOUT_MS, 5000),
    webPort: num(env.PORT, 3000),
    pumpId: num(env.POOL_PUMP_ID, 1),
  };
}
