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

const banner = document.getElementById('banner');
const updated = document.getElementById('updated');
const controllerTime = document.getElementById('controller-time');
const airTemp = document.getElementById('air-temp');
const viewControl = document.getElementById('view-control');
const viewSchedules = document.getElementById('view-schedules');
const viewPumps = document.getElementById('view-pumps');
const viewDetails = document.getElementById('view-details');
const toastEl = document.getElementById('toast');

let lastStatus = null;
// Local UI state: optimistic overrides + confirm/setpoint editing.
const pending = new Map();   // role -> { on, ts }
const confirming = new Set(); // roles awaiting inline confirm
const setEdit = new Map();    // body -> pending setpoint number

const GLOW = { pool: 'glow-pool', spa: 'glow-spa', spillway: 'glow-spill', poolLight: 'glow-light', spaLight: 'glow-light', yardLight: 'glow-light' };

// Vertical thermometer with a blue indicator (bulb + column).
const THERMO_SVG = '<svg viewBox="0 0 24 30" width="14" height="18" style="vertical-align:-4px" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v14a4 4 0 1 0 6 0V6a3 3 0 0 0-3-3z" fill="none" stroke="#8b98a5" stroke-width="1.6"/><rect x="11" y="8" width="2" height="15" rx="1" fill="#3b82f6"/><circle cx="12" cy="24" r="3" fill="#3b82f6"/></svg>';

const menuBtn = document.getElementById('menu-btn');
const menuList = document.getElementById('menu-list');

function setView(view) {
  viewControl.hidden = view !== 'control';
  viewSchedules.hidden = view !== 'schedules';
  viewPumps.hidden = view !== 'pumps';
  viewDetails.hidden = view !== 'details';
  document.querySelectorAll('.menu-item').forEach((it) => it.classList.toggle('active', it.dataset.view === view));
}
function closeMenu() { menuList.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }

menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = menuList.hidden;
  menuList.hidden = !willOpen;
  menuBtn.setAttribute('aria-expanded', String(willOpen));
});
menuList.addEventListener('click', (e) => {
  const it = e.target.closest('.menu-item');
  if (!it) return;
  setView(it.dataset.view);
  closeMenu();
});
document.addEventListener('click', () => { if (!menuList.hidden) closeMenu(); });
// Tapping the header title returns to Control (no-op if already there — setView is idempotent).
document.getElementById('home').addEventListener('click', () => setView('control'));

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2500);
}

function circuit(s, name) {
  return (s.circuits || []).find((c) => c.name?.toLowerCase() === name.toLowerCase());
}
// On-state for a role, honoring an optimistic override.
function isOn(role, actual) {
  const p = pending.get(role);
  return p ? p.on : actual;
}

async function postCommand(payload, role) {
  try {
    const res = await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${res.status}`);
    }
  } catch (err) {
    if (role) pending.delete(role);
    toast(`Command failed: ${err.message}`);
    render(lastStatus);
  }
}

function toggleCircuit(role, name, currentlyOn) {
  // Off is instant; on for guarded roles needs inline confirm.
  const guarded = role === 'pool' || role === 'spa' || role === 'spillway';
  if (!currentlyOn && guarded && !confirming.has(role)) { confirming.add(role); render(lastStatus); return; }
  confirming.delete(role);
  const desired = !currentlyOn;
  pending.set(role, { on: desired, ts: Date.now() });
  render(lastStatus);
  postCommand({ action: 'circuit', role, on: desired }, role);
}

function applySetpoint(body) {
  const tempF = setEdit.get(body);
  if (tempF == null) return;
  setEdit.delete(body);
  render(lastStatus);
  postCommand({ action: 'setpoint', body, tempF });
}

function toggleHeater(currentlyEnabled) {
  // Heater is a persistent setting → plain instant toggle (no confirm).
  const desired = !currentlyEnabled;
  pending.set('poolHeater', { on: desired, ts: Date.now() });
  render(lastStatus);
  postCommand({ action: 'heatmode', body: 'pool', enabled: desired }, 'poolHeater');
}

function heaterRow(s) {
  const enabled = pending.has('poolHeater') ? pending.get('poolHeater').on : !!s.pool.heatEnabled;
  const firing = !!s.pool.heaterOn;
  const stateText = firing ? 'Heating' : (enabled ? 'On' : 'Off');
  const flameCls = `hflame${enabled ? ' lit' : ''}${firing ? ' firing' : ''}`;
  return `<div class="heatrow">
    <span class="${flameCls}">🔥</span><span class="hlabel">Heater · ${stateText}</span>
    <button class="hswitch ${enabled ? 'on' : ''}" role="switch" aria-checked="${enabled}" data-act="heater" data-enabled="${enabled}"><span class="hknob"></span></button>
  </div>`;
}

// ---- rendering ----
function bodyTile(s, role, name, icon, glowClass) {
  const c = circuit(s, name);
  if (!c || !s[role]) return '';
  const on = isOn(role, c.on);
  const isPending = pending.has(role);
  const editing = setEdit.has(role === 'pool' ? 'pool' : 'spa');
  const body = role === 'pool' ? 'pool' : 'spa';
  const setVal = setEdit.has(body) ? setEdit.get(body) : s[role].setpointF;
  const heating = !!s[role].heaterOn;
  // Derive the schedule badge from the live schedule for this body's circuit (compact hours),
  // so it refreshes when the schedule changes instead of showing a hardcoded value.
  const sched = (s.schedules || []).find((x) => x.circuit?.toLowerCase() === name.toLowerCase());
  const scheduleBadge = sched ? `${sched.start}–${sched.stop}` : '';
  const cls = `tile ${heating ? 'heating' : (on ? glowClass : 'off')}${isPending ? ' pending' : ''}`;
  const toggle = confirming.has(role)
    ? `<span><button class="cbtn confirm" data-act="toggle" data-role="${role}" data-name="${name}" data-on="${on}">✓ Turn on</button> <button class="cbtn cancel" data-act="cancelconfirm" data-role="${role}">Cancel</button></span>`
    : `<button class="pill" data-act="toggle" data-role="${role}" data-name="${name}" data-on="${on}"><span class="dot ${on ? 'on' : ''}"></span> ${on ? 'ON' : 'OFF'}</button>`;
  return `<div class="${cls}">
    <div class="lblrow"><span class="ico">${icon}</span><span class="lbl">${name}</span>${scheduleBadge ? `<span class="sbadge">⏱ ${scheduleBadge}</span>` : ''}</div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:10px;"><div class="temp">${s[role].tempF}&deg;</div>${toggle}</div>
    <div style="margin-top:12px;"><span class="stepper"><button data-act="setdn" data-body="${body}" data-cur="${setVal}">−</button><b>${setVal}&deg;</b><button data-act="setup" data-body="${body}" data-cur="${setVal}">+</button></span>
      ${editing ? `<button class="cbtn confirm" data-act="applyset" data-body="${body}" style="margin-left:10px;">Apply ${setVal}&deg;</button>` : ''}</div>
    ${role === 'pool' ? heaterRow(s) : (heating ? '<div style="margin-top:12px;"><span class="heatchip lit firing">🔥 Heating</span></div>' : '')}
  </div>`;
}

function featureTile(s, role, name, icon, glowClass) {
  const c = circuit(s, name);
  if (!c) return '';
  const on = isOn(role, c.on);
  const isPending = pending.has(role);
  const cls = `tile ${on ? glowClass : 'off'}${isPending ? ' pending' : ''}`;
  const toggle = confirming.has(role)
    ? `<span><button class="cbtn confirm" data-act="toggle" data-role="${role}" data-name="${name}" data-on="${on}">✓ Turn on</button> <button class="cbtn cancel" data-act="cancelconfirm" data-role="${role}">Cancel</button></span>`
    : `<button class="pill" data-act="toggle" data-role="${role}" data-name="${name}" data-on="${on}"><span class="dot ${on ? 'on' : ''}"></span> ${on ? 'ON' : 'OFF'}</button>`;
  return `<div class="${cls}" style="display:flex;justify-content:space-between;align-items:center;">
    <div class="lblrow"><span class="ico">${icon}</span><div><span class="lbl">${name}</span><div style="font-size:12px;opacity:.85;">Run any time</div></div></div>${toggle}</div>`;
}

function lightTile(s, role, name, icon) {
  const c = circuit(s, name);
  if (!c) return '';
  const on = isOn(role, c.on);
  const cls = `tile ${on ? GLOW[role] : 'off'}${pending.has(role) ? ' pending' : ''}`;
  return `<div class="${cls}"><div class="lblrow"><span class="ico">${icon}</span><span class="lbl">${name}</span></div>
    <div style="margin-top:12px;"><button class="pill" data-act="toggle" data-role="${role}" data-name="${name}" data-on="${on}"><span class="dot ${on ? 'on' : ''}"></span> ${on ? 'ON' : 'OFF'}</button></div></div>`;
}

function yardTile(s) {
  const c = circuit(s, 'Yard Light');
  if (!c) return '';
  const on = isOn('yardLight', c.on);
  const sched = (s.schedules || []).find((x) => x.circuit?.toLowerCase() === 'yard light');
  const cls = `tile ${on ? GLOW.yardLight : 'off'}${pending.has('yardLight') ? ' pending' : ''}`;
  return `<div class="${cls}" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
    <div class="lblrow"><span class="ico">🌙</span><div><span class="lbl">Yard Light</span>${sched ? `<div style="font-size:12px;opacity:.85;margin-top:2px;">⏱ ${sched.start}–${sched.stop}</div>` : ''}</div></div>
    <button class="pill" data-act="toggle" data-role="yardLight" data-name="Yard Light" data-on="${on}" style="margin-left:auto;"><span class="dot ${on ? 'on' : ''}"></span> ${on ? 'ON' : 'OFF'}</button></div>`;
}

function renderControl(s) {
  const tiles = [
    bodyTile(s, 'pool', 'Pool', '🏊', GLOW.pool),
    featureTile(s, 'spillway', 'Spillway', '⛲', GLOW.spillway),
    bodyTile(s, 'spa', 'Spa', '♨️', GLOW.spa),
    '<div class="seclabel">Lights</div>',
    yardTile(s),
    `<div class="row2">${lightTile(s, 'poolLight', 'Pool Light', '💡')}${lightTile(s, 'spaLight', 'Spa Light', '💡')}</div>`,
  ].filter(Boolean);
  const info = [];
  if (s.chemistry) info.push(`<div class="card"><h2>Chemistry</h2><div>pH ${s.chemistry.ph}</div><div>ORP ${s.chemistry.orp}</div><div>Salt ${s.chemistry.saltPPM} ppm</div></div>`);
  viewControl.innerHTML = `<div class="ctl">${tiles.join('')}</div>${info.length ? `<div class="infogrid">${info.join('')}</div>` : ''}`;
}

// Static equipment inventory for this install (see docs/EQUIPMENT.md).
const EQUIPMENT = [
  ['Automation', 'Pentair EasyTouch (Compool LX3600)'],
  ['Main pump', 'Pentair IntelliFlo 2 VST'],
  ['Booster pump', 'Hayward ¾ HP (cleaner)'],
  ['Heater', 'Jandy JXi400N · 400k BTU gas'],
  ['Filter', 'Hayward DE4800 · 48 sq ft D.E.'],
];

function renderDetails(s) {
  const g = s.gateway || {};
  const conn = [
    ['Gateway', g.name || '—'],
    ['Address', g.ip ? `${g.ip}:${g.port}` : '—'],
    ['Status', g.connected ? '<span class="on">Connected</span>' : '<span class="off">Disconnected</span>'],
    ['Controller clock', s.systemTime?.clock ? clock12h(s.systemTime.clock.slice(11)) : '—'],
  ];
  const rows = (pairs) => pairs.map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
  viewDetails.innerHTML = `<div class="ctl">
    <div class="card"><h2>Connection</h2>${rows(conn)}</div>
    <div class="card"><h2>Equipment</h2>${rows(EQUIPMENT)}</div>
  </div>`;
}

function renderPumps(s) {
  const p = s.pump;
  if (!p) { viewPumps.innerHTML = '<div class="card"><h2>Pump</h2><div class="off">No pump data</div></div>'; return; }
  const metrics = [`${p.rpm} RPM`, `${p.watts} W`];
  if (p.gpm != null) metrics.push(`${p.gpm} GPM`);
  const status = p.running
    ? `<span class="on">● Running</span> · ${metrics.join(' · ')}`
    : '<span class="off">● Off</span>';
  const activeIds = new Set((s.circuits || []).filter((c) => c.on).map((c) => c.id));
  const rows = p.presets.map((pr) => {
    const cls = activeIds.has(pr.circuitId) ? ' class="on"' : '';
    return `<li><span${cls}>${pr.circuit}</span><span${cls}>${pr.rpm} RPM</span></li>`;
  }).join('');
  viewPumps.innerHTML = `<div class="card"><h2>${p.model}</h2>
    <div style="margin:.2rem 0 .8rem;">${status}</div>
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8b98a5;margin-bottom:.3rem;">Programmed speeds (read-only)</div>
    <ul>${rows}</ul></div>`;
}

// "7:30 PM" -> minutes since midnight (matches the schedule's display format).
function schedMinutes(t) {
  const m = /(\d+):(\d+)\s*(AM|PM)/i.exec(t || '');
  if (!m) return null;
  const h = (Number(m[1]) % 12) + (/pm/i.test(m[3]) ? 12 : 0);
  return h * 60 + Number(m[2]);
}
function withinWindow(now, start, stop) {
  if (now == null || start == null || stop == null) return false;
  return stop > start ? (now >= start && now < stop) : (now >= start || now < stop); // handles overnight
}

function renderSchedules(s) {
  if (!s.schedules) { viewSchedules.innerHTML = ''; return; }
  // "Running now" = the schedule's circuit is on AND the controller clock is in its window.
  let nowMin = null;
  if (s.systemTime?.clock) { const [h, m] = s.systemTime.clock.slice(11).split(':').map(Number); nowMin = h * 60 + m; }
  const onNames = new Set((s.circuits || []).filter((c) => c.on).map((c) => c.name.toLowerCase()));
  const rows = s.schedules.length
    ? s.schedules.map((sch) => {
        const days = sch.days?.length === 7 ? 'Every day' : (sch.days || []).join(' ');
        const tag = sch.type === 'run-once' ? ' <span class="off">once</span>' : '';
        const active = onNames.has(sch.circuit.toLowerCase()) && withinWindow(nowMin, schedMinutes(sch.start), schedMinutes(sch.stop));
        const running = active ? ' <span class="on">● Running</span>' : '';
        return `<li><span>${sch.circuit}${tag}${running}</span><span>${sch.start}–${sch.stop} · ${days}</span></li>`;
      }).join('')
    : '<li><span class="off">No schedules</span></li>';
  viewSchedules.innerHTML = `<div class="card"><h2>Schedules</h2><ul>${rows}</ul></div>`;
}

function reconcile(s) {
  // Drop optimistic overrides once the gateway reflects them or after 10s.
  for (const [role, p] of pending) {
    let actual;
    if (role === 'poolHeater') {
      if (s.pool == null) continue;
      actual = !!s.pool.heatEnabled;
    } else {
      const name = { pool: 'Pool', spa: 'Spa', spillway: 'Spillway', poolLight: 'Pool Light', spaLight: 'Spa Light', yardLight: 'Yard Light' }[role];
      const c = (s.circuits || []).find((x) => x.name?.toLowerCase() === name.toLowerCase());
      actual = c ? c.on : undefined;
    }
    if (actual === p.on || Date.now() - p.ts > 10000) pending.delete(role);
  }
}

// "HH:MM" (24h) -> "H:MM AM/PM" to match the rest of the UI.
function clock12h(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function render(s) {
  if (!s) return;
  lastStatus = s;
  renderControl(s);
  renderSchedules(s);
  renderPumps(s);
  renderDetails(s);
  if (s.gateway?.lastUpdate) updated.textContent = new Date(s.gateway.lastUpdate).toLocaleTimeString();
  if (s.systemTime?.clock) controllerTime.textContent = `Controller ${clock12h(s.systemTime.clock.slice(11))}`;
  if (s.air) airTemp.innerHTML = `${THERMO_SVG} Air ${s.air.tempF}° · `;
}

viewControl.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'toggle') toggleCircuit(el.dataset.role, el.dataset.name, el.dataset.on === 'true');
  else if (act === 'heater') toggleHeater(el.dataset.enabled === 'true');
  else if (act === 'cancelconfirm') { confirming.delete(el.dataset.role); render(lastStatus); }
  else if (act === 'setup' || act === 'setdn') {
    const body = el.dataset.body; const cur = Number(el.dataset.cur);
    const next = Math.max(40, Math.min(104, cur + (act === 'setup' ? 1 : -1)));
    setEdit.set(body, next); render(lastStatus);
  } else if (act === 'applyset') applySetpoint(el.dataset.body);
});

function connect() {
  const es = new EventSource('/events');
  es.onmessage = (e) => { banner.classList.remove('show'); const s = JSON.parse(e.data); reconcile(s); render(s); };
  es.onerror = () => { banner.classList.add('show'); };
}
connect();
