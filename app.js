'use strict';

// ── USERS ──────────────────────────────────────────────────────────────────
const USERS = {
  doctor: { password: '1234', role: 'Dr.' },
  nurse:  { password: '1234', role: 'Nurse' },
  admin:  { password: '1234', role: 'Admin' },
};

// ── PATIENTS ───────────────────────────────────────────────────────────────
const PATIENTS = [
  { id: 'P001', name: 'Ravi Kumar',    initials: 'RK', ward: 'Ward 3B', age: 47, condition: 'Post-op cardiac' },
  { id: 'P002', name: 'Anjali Mehta',  initials: 'AM', ward: 'Ward 1A', age: 34, condition: 'Respiratory ICU' },
  { id: 'P003', name: 'Suresh Patel',  initials: 'SP', ward: 'Ward 2C', age: 61, condition: 'Diabetes management' },
  { id: 'P004', name: 'Priya Sharma',  initials: 'PS', ward: 'Ward 4D', age: 28, condition: 'Maternity obs.' },
  { id: 'P005', name: 'Mohan Verma',   initials: 'MV', ward: 'Ward 5A', age: 73, condition: 'Renal failure' },
  { id: 'P006', name: 'Kavitha Nair',  initials: 'KN', ward: 'Ward 2B', age: 52, condition: 'Hypertension' },
];

// ── STATE ──────────────────────────────────────────────────────────────────
const HISTORY = 30;
let paused = false;
let currentPatientId = PATIENTS[0].id;
let alertLog = [];
let vitalsInterval = null;
let ecgAnimId = null;
let ecgPhase = 0;

// Per-patient vitals history stored separately
const patientData = {};
PATIENTS.forEach(p => {
  patientData[p.id] = {
    hr:   { history: [], min: 60, max: 100, alert: [50, 110] },
    spo2: { history: [], min: 95, max: 100, alert: [90, 101] },
    bp:   { history: [], min: 90, max: 120, alert: [80, 135] },
    temp: { history: [], min: 36.1, max: 37.2, alert: [35.5, 38.0] },
    risk: 'ok',
  };
});

// Patient-specific ranges (makes each patient feel different)
const patientRanges = {
  P001: { hr: [62, 108], spo2: [93, 100], bp: [85, 135], temp: [35.8, 38.0] },
  P002: { hr: [70, 120], spo2: [88, 99],  bp: [88, 130], temp: [36.5, 39.0] },
  P003: { hr: [58, 100], spo2: [94, 100], bp: [95, 145], temp: [36.0, 37.8] },
  P004: { hr: [65, 105], spo2: [96, 100], bp: [82, 120], temp: [36.2, 37.4] },
  P005: { hr: [55, 95],  spo2: [90, 99],  bp: [100, 155], temp: [35.5, 38.5] },
  P006: { hr: [68, 110], spo2: [94, 100], bp: [100, 150], temp: [36.1, 37.6] },
};

// ── LOGIN ──────────────────────────────────────────────────────────────────
function doLogin() {
  const username = document.getElementById('login-user').value.trim().toLowerCase();
  const password = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');

  if (!USERS[username] || USERS[username].password !== password) {
    errEl.textContent = 'Invalid username or password.';
    document.getElementById('login-pass').value = '';
    return;
  }

  errEl.textContent = '';
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('app').style.flexDirection = 'column';

  const u = USERS[username];
  document.getElementById('logged-user').textContent = `${u.role} ${username.charAt(0).toUpperCase() + username.slice(1)}`;

  initApp();
}

function doLogout() {
  clearInterval(vitalsInterval);
  cancelAnimationFrame(ecgAnimId);
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  alertLog = [];
}

// ── INIT ───────────────────────────────────────────────────────────────────
function initApp() {
  renderSidebar();
  selectPatient(PATIENTS[0].id);
  updateClock();
  setInterval(updateClock, 1000);
  vitalsInterval = setInterval(tick, 2000);
  tick();
  ecgLoop();
}

// ── SIDEBAR ────────────────────────────────────────────────────────────────
function renderSidebar() {
  const list = document.getElementById('patient-list');
  list.innerHTML = PATIENTS.map(p => `
    <li id="sidebar-${p.id}" onclick="selectPatient('${p.id}')">
      <div class="p-avatar">${p.initials}</div>
      <div class="p-info">
        <div class="p-name">${p.name}</div>
        <div class="p-ward">${p.ward}</div>
      </div>
      <div class="p-risk ok" id="risk-dot-${p.id}"></div>
    </li>
  `).join('');
}

function selectPatient(id) {
  currentPatientId = id;
  alertLog = [];
  renderAlerts();

  // Update sidebar active state
  document.querySelectorAll('#patient-list li').forEach(li => li.classList.remove('active'));
  const activeItem = document.getElementById(`sidebar-${id}`);
  if (activeItem) activeItem.classList.add('active');

  // Update patient bar
  const p = PATIENTS.find(p => p.id === id);
  document.getElementById('patient-avatar').textContent = p.initials;
  document.getElementById('patient-name').textContent = p.name;
  document.getElementById('patient-meta').textContent = `${p.id} · ${p.ward} · Age ${p.age} · ${p.condition}`;

  // Redraw with existing history for this patient
  const d = patientData[id];
  ['hr','spo2','bp','temp'].forEach(key => {
    const last = d[key].history[d[key].history.length - 1];
    if (last !== undefined) {
      document.getElementById(`${key}-val`).textContent = last;
      const s = severity(id, key, last);
      drawSparkline(`chart-${key}`, d[key].history, s);
    } else {
      document.getElementById(`${key}-val`).textContent = '--';
    }
  });
  updateRiskBadge(id);
}

// ── VITALS ENGINE ──────────────────────────────────────────────────────────
function rand(min, max, decimals = 0) {
  const v = Math.random() * (max - min) + min;
  return decimals ? +v.toFixed(decimals) : Math.round(v);
}

function generateVitals(patientId) {
  const r = patientRanges[patientId];
  return {
    hr:   rand(r.hr[0],   r.hr[1]),
    spo2: rand(r.spo2[0], r.spo2[1]),
    bp:   rand(r.bp[0],   r.bp[1]),
    temp: rand(r.temp[0], r.temp[1], 1),
  };
}

function severity(patientId, key, val) {
  const d = patientData[patientId][key];
  if (val < d.alert[0] || val > d.alert[1]) return 'danger';
  if (val < d.min || val > d.max) return 'warn';
  return 'ok';
}

function tick() {
  if (paused) return;

  // Update all patients (background simulation)
  PATIENTS.forEach(p => {
    const v = generateVitals(p.id);
    const d = patientData[p.id];
    const keys = ['hr','spo2','bp','temp'];
    let worstRisk = 'ok';

    keys.forEach(key => {
      d[key].history.push(v[key]);
      if (d[key].history.length > HISTORY) d[key].history.shift();
      const s = severity(p.id, key, v[key]);
      if (s === 'danger') worstRisk = 'danger';
      else if (s === 'warn' && worstRisk !== 'danger') worstRisk = 'warn';
    });

    d.risk = worstRisk;
    const dot = document.getElementById(`risk-dot-${p.id}`);
    if (dot) dot.className = `p-risk ${worstRisk}`;
  });

  // Update UI for current patient
  const v = patientData[currentPatientId];
  const labels = { hr: 'Heart rate', spo2: 'SpO₂', bp: 'Blood pressure', temp: 'Temperature' };
  const units  = { hr: 'bpm', spo2: '%', bp: 'mmHg', temp: '°C' };

  ['hr','spo2','bp','temp'].forEach(key => {
    const history = v[key].history;
    const val = history[history.length - 1];
    const s = severity(currentPatientId, key, val);

    const card = document.getElementById(`card-${key}`);
    card.className = 'vital-card' + (s === 'danger' ? ' alert' : '');
    document.getElementById(`${key}-val`).textContent = val;
    drawSparkline(`chart-${key}`, history, s);

    if (s !== 'ok') addAlert(`${labels[key]}: ${val} ${units[key]}`, s);
  });

  updateRiskBadge(currentPatientId);
}

function updateRiskBadge(id) {
  const badge = document.getElementById('riskBadge');
  const risk = patientData[id].risk;
  if (risk === 'danger')    { badge.textContent = 'High risk';   badge.className = 'risk-badge danger'; }
  else if (risk === 'warn') { badge.textContent = 'Medium risk'; badge.className = 'risk-badge warn'; }
  else                      { badge.textContent = 'Low risk';    badge.className = 'risk-badge'; }
}

// ── SPARKLINES ────────────────────────────────────────────────────────────
function drawSparkline(id, history, status) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth || 200;
  const h = 60;
  canvas.width  = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  if (history.length < 2) return;

  const minV = Math.min(...history);
  const maxV = Math.max(...history);
  const range = maxV - minV || 1;
  const colors = { ok: '#00e5c3', warn: '#ffb830', danger: '#ff4d6d' };
  const col = colors[status] || colors.ok;

  const pts = history.map((v, i) => ({
    x: (i / (history.length - 1)) * w,
    y: h - ((v - minV) / range) * (h - 10) - 5,
  }));

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const cp = { x: (pts[i-1].x + pts[i].x) / 2, y: (pts[i-1].y + pts[i].y) / 2 };
    ctx.quadraticCurveTo(pts[i-1].x, pts[i-1].y, cp.x, cp.y);
  }
  ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = col + '18';
  ctx.fill();

  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.fill();
}

// ── ECG ───────────────────────────────────────────────────────────────────
function drawECG() {
  const canvas = document.getElementById('ecg-canvas');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth || 600;
  const h = 100;
  canvas.width  = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = '#1e2840';
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += 20) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for (let y = 0; y < h; y += 20) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

  const pts = w * 2;
  const points = [];
  for (let i = 0; i < pts; i++) {
    const t = (i / pts) + ecgPhase;
    const cycle = t % 1;
    let y;
    if      (cycle < 0.05) y = cycle / 0.05 * 0.05;
    else if (cycle < 0.10) y = 0.05 - (cycle - 0.05) / 0.05 * 0.05;
    else if (cycle < 0.15) y = -(cycle - 0.10) / 0.05 * 0.10;
    else if (cycle < 0.18) y = -0.10 + (cycle - 0.15) / 0.03 * 0.70;
    else if (cycle < 0.22) y = 0.60 - (cycle - 0.18) / 0.04 * 1.20;
    else if (cycle < 0.26) y = -0.60 + (cycle - 0.22) / 0.04 * 0.70;
    else if (cycle < 0.30) y = 0.10 - (cycle - 0.26) / 0.04 * 0.15;
    else if (cycle < 0.40) y = -0.05 + Math.sin((cycle - 0.30) / 0.10 * Math.PI) * 0.20;
    else                   y = 0;
    points.push([(i / pts) * w, h / 2 - y * h * 0.42]);
  }

  const scanX = (ecgPhase % 1) * w;
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#00e5c300');
  grad.addColorStop(Math.max(0, scanX/w - 0.02), '#00e5c3cc');
  grad.addColorStop(scanX/w, '#00e5c3');
  grad.addColorStop(Math.min(1, scanX/w + 0.08), '#00e5c300');
  grad.addColorStop(1, '#00e5c300');

  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function ecgLoop() {
  if (!paused) { ecgPhase += 0.005; drawECG(); }
  ecgAnimId = requestAnimationFrame(ecgLoop);
}

// ── ALERTS ────────────────────────────────────────────────────────────────
function addAlert(msg, level) {
  const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  alertLog.unshift({ msg, level, time });
  if (alertLog.length > 50) alertLog.pop();
  renderAlerts();
}

function renderAlerts() {
  const list = document.getElementById('alert-list');
  if (!alertLog.length) {
    list.innerHTML = '<li class="ok" style="opacity:0.5">No alerts</li>';
    return;
  }
  list.innerHTML = alertLog.slice(0, 20).map(a =>
    `<li class="${a.level}">[${a.time}] ${a.msg}</li>`
  ).join('');
}

function simulateAlert() {
  const alerts = [
    { msg: 'SpO₂ dropped to 88%', level: 'danger' },
    { msg: 'Heart rate 132 bpm — tachycardia', level: 'danger' },
    { msg: 'BP elevated: 141 mmHg', level: 'warn' },
    { msg: 'Temperature: 38.4°C', level: 'warn' },
  ];
  const a = alerts[Math.floor(Math.random() * alerts.length)];
  addAlert(a.msg, a.level);
}

function clearAlerts() { alertLog = []; renderAlerts(); }

function togglePause() {
  paused = !paused;
  document.getElementById('pauseBtn').textContent = paused ? 'Resume' : 'Pause';
}

function updateClock() {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

window.addEventListener('resize', () => {
  drawECG();
  ['hr','spo2','bp','temp'].forEach(k => {
    const h = patientData[currentPatientId][k].history;
    drawSparkline(`chart-${k}`, h, 'ok');
  });
});