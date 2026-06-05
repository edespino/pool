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

import { loadConfig } from '../src/config.js';
import { discoverGateway } from '../src/discovery.js';
import { findUnits } from '../src/slAdapter.js';

const config = loadConfig();
console.log(`Searching for "${config.gatewayName}" (timeout ${config.discoveryTimeoutMs}ms)...`);

try {
  const gw = await discoverGateway(config, findUnits);
  console.log(`Discovered ${gw.name} at ${gw.ip}:${gw.port} via ${gw.via}`);
  process.exit(0);
} catch (err) {
  console.error(`Discovery failed: ${err.message}`);
  console.error('Tip: set POOL_GATEWAY_IP=<gateway ip> to use the manual fallback.');
  process.exit(1);
}
