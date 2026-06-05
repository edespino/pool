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

const BODY_LABELS = { 1: 'pool', 2: 'spa' }; // body ids per real EE-59-51 hardware: 1=pool, 2=spa
const HIDDEN_CIRCUIT = /^(aux|feature)/i;
const PUMP_MODELS = { 3: 'IntelliFlo VS', 4: 'IntelliFlo VSF', 5: 'IntelliFlo VF' };

function circuitNames(controllerConfig) {
  return new Map((controllerConfig.circuitArray ?? []).map((c) => [c.circuitId, c.name]));
}

function formatHHMM(t) {
  const s = String(t).padStart(4, '0');
  const hour = Number(s.slice(0, 2));
  const minute = s.slice(2, 4);
  const period = hour < 12 ? 'AM' : 'PM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${period}`;
}

function body(state, id) {
  const b = state.bodies?.find((x) => x.id === id);
  if (!b) return undefined;
  return { tempF: b.currentTemp, setpointF: b.setPoint, heaterOn: b.heatStatus !== 0, heatEnabled: b.heatMode !== 0 };
}

export function normalizeStatus(controllerConfig, equipmentState) {
  const names = circuitNames(controllerConfig);

  const status = {
    air: { tempF: equipmentState.airTemp },
    circuits: (equipmentState.circuitArray ?? [])
      .map((c) => ({
        id: c.id,
        name: names.get(c.id) ?? `Circuit ${c.id}`,
        on: c.state !== 0,
      }))
      .filter((c) => !HIDDEN_CIRCUIT.test(c.name)),
  };

  for (const [id, label] of Object.entries(BODY_LABELS)) {
    const b = body(equipmentState, Number(id));
    if (b) status[label] = b;
  }

  if (equipmentState.pH > 0) {
    status.chemistry = {
      ph: equipmentState.pH,
      orp: equipmentState.orp,
      saltPPM: equipmentState.saltPPM,
    };
  }

  return status;
}

export function normalizeSystemTime(raw) {
  const p = (n) => String(n).padStart(2, '0');
  return {
    clock: `${raw.year}-${p(raw.month)}-${p(raw.day)} ${p(raw.hour)}:${p(raw.minute)}`,
    adjustForDST: raw.adjustForDST,
  };
}

export function normalizeSchedules(recurring = [], runOnce = [], controllerConfig = {}) {
  const names = circuitNames(controllerConfig);
  const mapList = (list, type) =>
    list.map((s) => ({
      id: s.scheduleId,
      type,
      circuit: names.get(s.circuitId) ?? `Circuit ${s.circuitId}`,
      start: formatHHMM(s.startTime),
      stop: formatHHMM(s.stopTime),
      days: s.days ?? [],
    }));
  return [...mapList(recurring, 'recurring'), ...mapList(runOnce, 'run-once')];
}

export function normalizePump(rawPumpStatus, controllerConfig = {}) {
  const names = circuitNames(controllerConfig);
  const presets = (rawPumpStatus.pumpCircuits ?? [])
    .filter((pc) => {
      const name = names.get(pc.circuitId);
      return name && !HIDDEN_CIRCUIT.test(name);
    })
    .map((pc) => ({ circuitId: pc.circuitId, circuit: names.get(pc.circuitId), rpm: pc.speed }));
  return {
    model: PUMP_MODELS[rawPumpStatus.pumpType] ?? `Pump (type ${rawPumpStatus.pumpType})`,
    // The pump's isRunning flag is unreliable — it reads true when the pump is off,
    // with rpm/watts 0 and gpm 255 (0xFF "no data" sentinel). A variable-speed pump
    // that is actually running always reports a nonzero RPM, so derive running from that.
    running: rawPumpStatus.pumpRPMs > 0,
    rpm: rawPumpStatus.pumpRPMs,
    watts: rawPumpStatus.pumpWatts,
    // 255 (0xFF) is the "no data" sentinel — this system has no flow sensor, so gpm
    // reads 255 even while running. Surface it as null (unknown) rather than "255 GPM".
    gpm: rawPumpStatus.pumpGPMs === 255 ? null : rawPumpStatus.pumpGPMs,
    presets,
  };
}
