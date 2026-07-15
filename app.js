/* ============================================================
   Vysage — App logic
   ============================================================ */

const STORAGE_PROFILE = 'vysage_profile_v1';
const STORAGE_SCANS = 'vysage_scans_v1';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let state = {
  step: 0,
  profile: { name: '', age: '', gender: '', goals: [] },
  currentStream: null,
  lastAnalysis: null,
};

/* ---------------- Onboarding ---------------- */

function loadProfile() {
  try { return JSON.parse(localStorage.getItem(STORAGE_PROFILE) || 'null'); }
  catch (e) { return null; }
}
function saveProfile(p) { localStorage.setItem(STORAGE_PROFILE, JSON.stringify(p)); }

function loadScans() {
  try { return JSON.parse(localStorage.getItem(STORAGE_SCANS) || '[]'); }
  catch (e) { return []; }
}
function saveScans(list) { localStorage.setItem(STORAGE_SCANS, JSON.stringify(list)); }

function showStep(n) {
  $$('#onboarding .screen').forEach((el) => el.classList.add('hidden'));
  $(`#onboarding .screen[data-step="${n}"]`).classList.remove('hidden');
  state.step = n;
}

function initOnboarding() {
  $$('#onboarding [data-next]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.step === 4) { finishOnboarding(); return; }
      showStep(state.step + 1);
    });
  });
  $$('#onboarding [data-back]').forEach((btn) => {
    btn.addEventListener('click', () => showStep(Math.max(0, state.step - 1)));
  });

  const nameInput = $('#in-name');
  nameInput.addEventListener('input', () => {
    state.profile.name = nameInput.value.trim();
    $('#btn-step1').disabled = state.profile.name.length < 1;
  });

  const ageInput = $('#in-age');
  ageInput.addEventListener('input', () => {
    const v = parseInt(ageInput.value, 10);
    state.profile.age = ageInput.value;
    $('#btn-step2').disabled = !(v >= 13 && v <= 99);
  });

  $$('#gender-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $$('#gender-chips .chip').forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
      state.profile.gender = chip.dataset.value;
      $('#btn-step3').disabled = false;
    });
  });

  $$('#goal-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      const v = chip.dataset.value;
      const i = state.profile.goals.indexOf(v);
      if (chip.classList.contains('selected') && i === -1) state.profile.goals.push(v);
      if (!chip.classList.contains('selected') && i !== -1) state.profile.goals.splice(i, 1);
    });
  });
}

function finishOnboarding() {
  saveProfile(state.profile);
  $('#onboarding').classList.add('hidden');
  $('#mainapp').classList.remove('hidden');
  $('#greet-text').textContent = state.profile.name ? state.profile.name.toUpperCase() : '';
  renderProfileView();
  startCamera();
}

/* ---------------- Navigation ---------------- */

function initNav() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });
  $('#link-rescan').addEventListener('click', () => switchView('scan'));
  $('#btn-empty-scan').addEventListener('click', () => switchView('scan'));
}

function switchView(name) {
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${name}`).classList.remove('hidden');
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  if (name === 'scan') startCamera(); else stopCamera();
  if (name === 'dashboard') renderDashboard();
  if (name === 'progress') renderProgress();
  if (name === 'profile') renderProfileView();
}

/* ---------------- Camera / capture ---------------- */

async function startCamera() {
  const video = $('#video');
  $('#still-img').classList.add('hidden');
  video.classList.remove('hidden');
  if (state.currentStream) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    state.currentStream = stream;
    video.srcObject = stream;
  } catch (err) {
    $('#scan-hint').textContent = 'Camera unavailable — use Upload photo instead';
  }
}

function stopCamera() {
  if (state.currentStream) {
    state.currentStream.getTracks().forEach((t) => t.stop());
    state.currentStream = null;
  }
}

function initScanControls() {
  $('#btn-upload').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => runAnalysisOnImage(img);
    img.src = URL.createObjectURL(file);
  });
  $('#btn-capture').addEventListener('click', captureFromVideo);
}

function captureFromVideo() {
  const video = $('#video');
  if (!video.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const img = new Image();
  img.onload = () => runAnalysisOnImage(img);
  img.src = canvas.toDataURL('image/jpeg', 0.92);
}

/* ---------------- Analysis pipeline ---------------- */

function showLoading(text) {
  $('#loading-overlay').classList.remove('hidden');
  $('#loading-text').textContent = text;
}
function hideLoading() { $('#loading-overlay').classList.add('hidden'); }
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

async function runAnalysisOnImage(imgEl) {
  showLoading('Loading measurement models…');
  const ok = await ensureModelsLoaded((msg) => $('#loading-text').textContent = msg);
  if (!ok) { hideLoading(); toast('Could not load models — check connection'); return; }

  $('#loading-text').textContent = 'Locating landmarks…';
  const canvas = document.createElement('canvas');
  canvas.width = imgEl.naturalWidth || imgEl.width;
  canvas.height = imgEl.naturalHeight || imgEl.height;
  canvas.getContext('2d').drawImage(imgEl, 0, 0, canvas.width, canvas.height);

  let result;
  try {
    result = await detectFace(canvas);
  } catch (err) {
    console.error(err);
    hideLoading();
    toast('Detection failed — try a clearer, front-facing photo');
    return;
  }
  if (!result) {
    hideLoading();
    toast('No face detected — try better lighting, face centered');
    return;
  }

  $('#loading-text').textContent = 'Computing geometry…';
  const analysis = analyzeLandmarks(result.landmarks, canvas);
  const thumb = shrinkToThumb(canvas, 120);

  const record = {
    date: new Date().toISOString(),
    overall: analysis.overall,
    potential: analysis.potential,
    metrics: analysis.metrics,
    landmarkPoints: analysis.landmarkPoints,
    imageSize: analysis.imageSize,
    thumb,
  };
  const scans = loadScans();
  scans.push(record);
  saveScans(scans);
  state.lastAnalysis = record;

  hideLoading();
  switchView('dashboard');
}

function shrinkToThumb(canvas, size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const s = Math.min(canvas.width, canvas.height);
  const sx = (canvas.width - s) / 2, sy = (canvas.height - s) / 2;
  ctx.drawImage(canvas, sx, sy, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.6);
}

/* ---------------- Dashboard rendering ---------------- */

function renderDashboard() {
  const scans = loadScans();
  if (!scans.length) {
    $('#dashboard-empty').classList.remove('hidden');
    $('#dashboard-content').classList.add('hidden');
    return;
  }
  $('#dashboard-empty').classList.add('hidden');
  $('#dashboard-content').classList.remove('hidden');

  const latest = scans[scans.length - 1];
  const tierInfo = tierFor(latest.overall);

  $('#score-overall').textContent = latest.overall.toFixed(1);
  $('#score-tier').textContent = tierInfo.tier;
  $('#score-label').textContent = tierInfo.label;
  $('#score-potential').textContent = `Potential ${latest.potential.toFixed(1)} · ${scans.length} scan${scans.length > 1 ? 's' : ''} logged`;

  const circumference = 2 * Math.PI * 46;
  const offset = circumference - (latest.overall / 10) * circumference;
  $('#ring-fill').setAttribute('stroke-dasharray', circumference.toFixed(1));
  $('#ring-fill').setAttribute('stroke-dashoffset', offset.toFixed(1));

  renderMetricGrid(latest.metrics);
  renderBlueprint(latest);
  renderProtocols(latest.metrics);
}

function colorForScore(score) {
  if (score >= 7.3) return '#3EB8A6';
  if (score >= 5.5) return '#C9A24B';
  return '#C1553D';
}

function renderMetricGrid(metrics) {
  const grid = $('#metric-grid');
  grid.innerHTML = '';
  Object.values(metrics).forEach((m) => {
    const col = colorForScore(m.score);
    const div = document.createElement('div');
    div.className = 'metric-card';
    div.innerHTML = `
      <div class="m-top">
        <span class="m-name">${m.label}</span>
        <span class="m-val" style="color:${col}">${m.score.toFixed(1)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${m.score * 10}%; background:${col}"></div></div>
    `;
    grid.appendChild(div);
  });
}

function renderBlueprint(record) {
  const svg = $('#blueprint-svg');
  const pts = record.landmarkPoints;
  const { w, h } = record.imageSize;
  if (!pts || !w) { svg.innerHTML = ''; return; }

  const pad = 20;
  const vw = 220, vh = 260;
  const scale = Math.min((vw - pad * 2) / w, (vh - pad * 2) / h);
  const offX = (vw - w * scale) / 2;
  const offY = (vh - h * scale) / 2;
  const P = (i) => `${(pts[i].x * scale + offX).toFixed(1)},${(pts[i].y * scale + offY).toFixed(1)}`;
  const seg = (arr) => arr.map(P).join(' ');

  const jaw = seg([...Array(17).keys()]);
  const rBrow = seg([17, 18, 19, 20, 21]);
  const lBrow = seg([22, 23, 24, 25, 26]);
  const noseBridge = seg([27, 28, 29, 30]);
  const noseBase = seg([31, 32, 33, 34, 35]);
  const rEye = seg([36, 37, 38, 39, 40, 41, 36]);
  const lEye = seg([42, 43, 44, 45, 46, 47, 42]);
  const outerMouth = seg([48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 48]);
  const midX = ((pts[27].x + pts[8].x) / 2 * scale + offX).toFixed(1);

  svg.innerHTML = `
    <line x1="${midX}" y1="${offY}" x2="${midX}" y2="${vh - offY}" stroke="#3EB8A6" stroke-width="0.6" stroke-dasharray="3 3" opacity="0.5"/>
    <polyline points="${jaw}" fill="none" stroke="#C9A24B" stroke-width="1.2"/>
    <polyline points="${rBrow}" fill="none" stroke="#8A93A0" stroke-width="1"/>
    <polyline points="${lBrow}" fill="none" stroke="#8A93A0" stroke-width="1"/>
    <polyline points="${noseBridge}" fill="none" stroke="#8A93A0" stroke-width="1"/>
    <polyline points="${noseBase}" fill="none" stroke="#8A93A0" stroke-width="1"/>
    <polygon points="${rEye}" fill="none" stroke="#3EB8A6" stroke-width="1"/>
    <polygon points="${lEye}" fill="none" stroke="#3EB8A6" stroke-width="1"/>
    <polygon points="${outerMouth}" fill="none" stroke="#C1553D" stroke-width="1"/>
  `;
}

const PROTOCOL_LIBRARY = {
  jawline: { tag: 'Jawline', text: 'Neck and jaw isometric holds, posture drills, and reduced mouth-breathing — small daily practices, not overnight fixes.' },
  symmetry: { tag: 'Symmetry', text: 'Symmetry is mostly structural. Even lighting and consistent camera angle when tracking will matter more than any routine.' },
  skin: { tag: 'Skin', text: 'Consistent SPF, a simple cleanse/moisturize routine, and sleep are the highest-leverage, lowest-risk changes.' },
  midface: { tag: 'Midface', text: 'Midface proportion is largely bone-structure driven and stable — tracking trend over time is more useful than chasing this number.' },
  nose: { tag: 'Nose', text: 'Nose proportion is structural. Contour and photo angle can change how it reads far more than anything else.' },
  eyes: { tag: 'Eyes', text: 'Sleep quality and hydration visibly affect the under-eye area more than any single "eye exercise."' },
};

function renderProtocols(metrics) {
  const list = $('#protocol-list');
  list.innerHTML = '';
  const sorted = Object.entries(metrics).sort((a, b) => a[1].score - b[1].score).slice(0, 3);
  sorted.forEach(([key, m]) => {
    const lib = PROTOCOL_LIBRARY[key] || { tag: m.label, text: 'Track this metric over successive scans to see its trend.' };
    const div = document.createElement('div');
    div.className = 'protocol-card';
    div.innerHTML = `
      <div class="p-top"><h4>${m.label}</h4><span class="tag">${lib.tag}</span></div>
      <p>${lib.text}</p>
    `;
    list.appendChild(div);
  });
}

/* ---------------- Progress view ---------------- */

function renderProgress() {
  const scans = loadScans();
  const historyList = $('#history-list');
  const emptyEl = $('#history-empty');
  historyList.innerHTML = '';

  if (!scans.length) {
    emptyEl.classList.remove('hidden');
    $('#chart-wrap').classList.add('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  $('#chart-wrap').classList.remove('hidden');

  // Chart
  const svg = $('#progress-chart');
  const vw = 300, vh = 140, pad = 18;
  const vals = scans.map((s) => s.overall);
  const minV = Math.max(0, Math.min(...vals) - 0.5);
  const maxV = Math.min(10, Math.max(...vals) + 0.5);
  const range = Math.max(0.5, maxV - minV);
  const stepX = scans.length > 1 ? (vw - pad * 2) / (scans.length - 1) : 0;
  const pts = scans.map((s, i) => {
    const x = pad + i * stepX;
    const y = vh - pad - ((s.overall - minV) / range) * (vh - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const dots = scans.map((s, i) => {
    const [x, y] = pts[i].split(',');
    return `<circle cx="${x}" cy="${y}" r="3" fill="#C9A24B"/>`;
  }).join('');
  svg.innerHTML = `
    <polyline points="${pts.join(' ')}" fill="none" stroke="#3EB8A6" stroke-width="1.6"/>
    ${dots}
  `;

  // History rows, newest first
  [...scans].reverse().forEach((s) => {
    const row = document.createElement('div');
    row.className = 'history-row';
    const d = new Date(s.date);
    row.innerHTML = `
      <img class="thumb" src="${s.thumb}" />
      <div class="hmeta">
        <div class="date">${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
        <div class="lbl">${tierFor(s.overall).label}</div>
      </div>
      <div class="hscore">${s.overall.toFixed(1)}</div>
    `;
    historyList.appendChild(row);
  });
}

/* ---------------- Profile view ---------------- */

const GOAL_LABELS = { jawline: 'Jawline', skin: 'Skin', symmetry: 'Symmetry', posture: 'Posture', curious: 'Curious' };
const GENDER_LABELS = { masc: 'Masculine norms', fem: 'Feminine norms', neutral: 'Neutral / blended' };

function renderProfileView() {
  const p = loadProfile();
  if (!p) return;
  $('#p-name').textContent = p.name || '—';
  $('#p-age').textContent = p.age || '—';
  $('#p-gender').textContent = GENDER_LABELS[p.gender] || '—';
  $('#p-goals').textContent = (p.goals && p.goals.length) ? p.goals.map((g) => GOAL_LABELS[g] || g).join(', ') : '—';
  $('#p-count').textContent = loadScans().length;
}

function initProfileActions() {
  $('#btn-reset').addEventListener('click', () => {
    if (confirm('Erase your profile and all scan history from this device? This cannot be undone.')) {
      localStorage.removeItem(STORAGE_PROFILE);
      localStorage.removeItem(STORAGE_SCANS);
      location.reload();
    }
  });
}

/* ---------------- Boot ---------------- */

function boot() {
  initOnboarding();
  initNav();
  initScanControls();
  initProfileActions();

  const existing = loadProfile();
  if (existing) {
    state.profile = existing;
    $('#onboarding').classList.add('hidden');
    $('#mainapp').classList.remove('hidden');
    $('#greet-text').textContent = existing.name ? existing.name.toUpperCase() : '';
    startCamera();
  } else {
    showStep(0);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', boot);
