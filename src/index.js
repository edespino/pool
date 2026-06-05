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

import { loadConfig } from './config.js';
import { discoverGateway } from './discovery.js';
import * as adapter from './slAdapter.js';
import { createSession } from './gatewaySession.js';
import { createServer } from './server.js';
import { installUnhandledRejectionGuard } from './processGuards.js';

// Keep the server alive through node-screenlogic's teardown-timeout orphan
// rejection (see processGuards.js); the session reconnects on its own.
installUnhandledRejectionGuard();

const config = { ...loadConfig(), baseDelayMs: 1000, maxDelayMs: 30000 };
const discover = (cfg) => discoverGateway(cfg, adapter.findUnits);
const session = createSession({ config, discover, adapter });

session.on('connected', (gw) => console.log(`Connected to ${gw.name} at ${gw.ip}:${gw.port} via ${gw.via}`));
session.on('reconnect', ({ attempt }) => console.log(`Reconnecting (attempt ${attempt})...`));
session.on('connectError', (err) => console.warn(`Connect attempt failed: ${err.message}`));
session.on('error', (err) => console.error(`Session error: ${err.message}`));

const app = createServer(session, adapter);
app.listen(config.webPort, () => console.log(`Pool dashboard on http://localhost:${config.webPort}`));
