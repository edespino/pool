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

export async function discoverGateway(config, findUnits) {
  const units = await findUnits(config.discoveryTimeoutMs);
  const match = units.find(
    (u) => typeof u.gatewayName === 'string' && u.gatewayName.includes(config.gatewayName),
  );
  if (match) {
    return { ip: match.address, port: match.port, name: config.gatewayName, via: 'broadcast' };
  }
  if (config.gatewayIp) {
    return {
      ip: config.gatewayIp,
      port: config.gatewayPort,
      name: config.gatewayName,
      via: 'configured-ip',
    };
  }
  throw new Error(
    `Could not locate gateway "${config.gatewayName}" via broadcast and no POOL_GATEWAY_IP is set`,
  );
}
