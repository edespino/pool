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

import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { discoverGateway } from '../src/discovery.js';
import * as adapter from '../src/slAdapter.js';

const config = loadConfig();
const gw = await discoverGateway(config, adapter.findUnits);
console.log(`Connecting to ${gw.name} at ${gw.ip}:${gw.port}...`);
const conn = await adapter.connect({ name: gw.name, ip: gw.ip, port: gw.port, password: config.gatewayPassword });

const controllerConfig = await adapter.getControllerConfig(conn);
const equipmentState = await adapter.getEquipmentState(conn);
writeFileSync('capture.controllerConfig.json', JSON.stringify(controllerConfig, null, 2));
writeFileSync('capture.equipmentState.json', JSON.stringify(equipmentState, null, 2));
await adapter.close(conn);
console.log('Wrote capture.controllerConfig.json and capture.equipmentState.json');
process.exit(0);
