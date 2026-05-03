'use strict';

const HISTORY = 30;
let paused = false;
let alertLog = [];

const data = {
  hr:   { history: [], min: 60, max: 100, alert: [50, 110] },
  spo2: { history: [], min: 95, max: 100, alert: [90, 101] },
  bp:   { history: [], min: 90, max: 120, alert: [80, 135] },
  temp: { history: [], min: 36.1, max: 37.2, alert: [35.5, 38.0] },
};

function rand(min, max, decimals = 0) {
  const v = Math.random() * (max - min) + min;
  return decimals ? +v.toFixed(decimals) : Math.round(v);
}

function generateVitals() {
  return {
    hr:   rand(58, 115),
    spo2: rand(92, 100),
    bp:   rand(82, 138),
    temp: rand(35.4, 38.2, 1),
  };
}

function severity(key, val) {
  const d = data[key];
  if (val < d.alert[0] || val > d.alert[1]) return 'danger';
  if (val < d.min || val > d.max) return 'warn';
  return 'ok';
}

function updateVitals() {
  const v = generateVitals();
  const keys = ['hr', 'spo2', 'bp', 'temp'];
  const labels = { hr: 'Heart rate', spo2: 'SpO₂', bp: 'Blood pressure', temp: 'Temperature' };
  const units  = { hr: 'bpm', spo2: '%', bp: 'mmHg', temp: '°C' };

  keys.forEach(key => {
    const val = v[key];
    data[key].history.push(val);
    if (data[key].history.length > HISTORY) data[key].history.shift();

    const s = severity(key, val);
    const card = document.getElementById(`card-${key}`);
    card.className = 'vital-card' + (s === 'danger' ? ' alert' : '');
    document.getElementById(`${key}-val`).textContent = val;
    drawSparkline(`chart-${key}`, data[key].history, s);

    if (s !== 'ok') {
      addAlert(`${labels[key]}: ${val} ${units[key]}`, s);
    }
  });

  updateRiskBadge(v);
}

function updateRiskBadge(v) {
  const badge = document.getElementById('riskBadge');
  const isRed  = severity('hr', v.hr) === 'danger' || severity('spo2', v.spo2) === 'danger';
  const isAmb  = severity('bp', v.bp) === 'warn'   || severity('temp', v.temp) === 'warn';
  if (isRed)      { badge.textContent = 'High risk';    badge.className = 'risk-badge danger'; }
  else if (isAmb) { badge.textContent = 'Medium risk';  badge.className = 'risk-badge warn'; }
  else            { badge.textContent = 'Low risk';      badge.className = 'risk-badge'; }
}

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

  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = col + '18';
  ctx.fill();

  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.fill();
}

let ecgPhase = 0;
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
  for (let x = 0; x < w; x += 20) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += 20) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  const pts = w * 2;
  const points = [];
  for (let i = 0; i < pts; i++) {
    const t = (i / pts) + ecgPhase;
    const cycle = t % 1;
    let y;
    if (cycle < 0.05)      y = cycle / 0.05 * 0.05;
    else if (cycle < 0.1)  y = 0.05 - (cycle - 0.05) / 0.05 * 0.05;
    else if (cycle < 0.15) y = -(cycle - 0.1) / 0.05 * 0.1;
    else if (cycle < 0.18) y = -0.1 + (cycle - 0.15) / 0.03 * 0.7;
    else if (cycle < 0.22) y = 0.6 - (cycle - 0.18) / 0.04 * 1.2;
    else if (cycle < 0.26) y = -0.6 + (cycle - 0.22) / 0.04 * 0.7;
    else if (cycle < 0.30) y = 0.1 - (cycle - 0.26) / 0.04 * 0.15;
    else if (cycle < 0.40) y = -0.05 + Math.sin((cycle - 0.30) / 0.10 * Math.PI) * 0.2;
    else                   y = 0;

    const px = (i / pts) * w;
    const py = h / 2 - y * (h * 0.42);
    points.push([px, py]);
  }

  const scanX = (ecgPhase % 1) * w;
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#00e5c300');
  grad.addColorStop(Math.max(0, (scanX / w) - 0.02), '#00e5c3cc');
  grad.addColorStop(scanX / w, '#00e5c3');
  grad.addColorStop(Math.min(1, (scanX / w) + 0.08), '#00e5c300');
  grad.addColorStop(1, '#00e5c300');

  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function addAlert(msg, level) {
  const now = new Date();
  const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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

function clearAlerts() {
  alertLog = [];
  renderAlerts();
}

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

let ecgAnimId;
function ecgLoop() {
  if (!paused) {
    ecgPhase += 0.005;
    drawECG();
  }
  ecgAnimId = requestAnimationFrame(ecgLoop);
}

setInterval(() => { if (!paused) updateVitals(); }, 2000);
setInterval(updateClock, 1000);

updateVitals();
updateClock();
renderAlerts();
ecgLoop();

window.addEventListener('resize', () => {
  drawECG();
  ['hr','spo2','bp','temp'].forEach(k => drawSparkline(`chart-${k}`, data[k].history, 'ok'));
});