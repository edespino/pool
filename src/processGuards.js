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

// node-screenlogic's UnitConnection.closeAsync fires removeClientAsync() WITHOUT
// awaiting it and re-throws in a .catch, then destroys the socket immediately —
// so the remove-client ack never arrives and that orphan promise rejects with
// "time out waiting for remove client response" ~netTimeout after every teardown.
// The rejection isn't reachable from the promise closeAsync returns, so it can't
// be caught at our await; on Node (--unhandled-rejections=throw) it would crash
// the process. This guard keeps the long-running server alive — the gateway
// session's reconnect loop handles actual recovery. Failures are still logged.
export function installUnhandledRejectionGuard(log = console.error) {
  process.on('unhandledRejection', (reason) => {
    const msg = reason && reason.message ? reason.message : String(reason);
    log(`Ignoring unhandled rejection to keep the server alive: ${msg}`);
  });
}
