/* ============================================================
   Vysage — App logic (v3)

   v3 changes vs v2:
   - Dashboard "How to improve" and Progress "History" now
     collapse to a compact preview with a "Show all" toggle
     (kills the endless scroll on both screens).
   - Rotating pop-up system: fun facts, plan promos, daily
     reminders, weekly focus plans, and quick tips fire on
     dashboard visits and idle timers with per-type throttling.
   - GIF export: progress reported per encoded frame (fixes
     the "stuck at 94%" perception), worker script is loaded
     via a same-origin blob URL so cross-origin worker loads
     don't hang, and a hard 45s watchdog aborts a hung render
     instead of leaving the button spinning forever.
   - Small entrance/pulse animations added via injected CSS
     so key CTAs and popup cards feel alive.
   ============================================================ */

const STORAGE_PROFILE = 'vysage_profile_v2';
const STORAGE_SCANS = 'vysage_scans_v2';
const STORAGE_DAILY = 'vysage_daily_v1';
const STORAGE_PLAN = 'vysage_plan_v1';
const FREE_HISTORY_LIMIT = 5;
const HISTORY_PREVIEW = 3;      // rows shown before "Show all"
const PROTOCOL_PREVIEW = 2;     // cards shown before "Show more"

const PLAN_FEATURES = [
  { label: 'Daily scans', free: '2 / day', pro: 'Unlimited' },
  { label: 'Scan history', free: `Last ${FREE_HISTORY_LIMIT}`, pro: 'Full history' },
  { label: 'Reveal exports', free: 'Watermarked', pro: 'No watermark' },
  { label: 'Improvement protocols', free: 'Top 3', pro: 'Full breakdown' },
  { label: 'Archetype insight', free: 'Basic match', pro: 'Full compatibility' },
  { label: 'New features', free: '—', pro: 'Early access' },
];
const PLAN_PRICING = {
  monthly: { big: '$6.99', sub: '/ month' },
  yearly: { big: '$39.99', sub: '/ year' },
};

const FUN_FACTS = [
  "The 'rule of thirds' for faces was popularized by Renaissance-era portrait artists, not modern skincare culture.",
  "Facial symmetry is judged more by consistency across expressions than by any single still photo.",
  "Canthal tilt is mostly bone structure — but sleep position over years can subtly affect the under-eye area.",
  "The 'golden ratio' claim for faces (1.618) is popular online but has never been consistently proven in attractiveness research.",
  "Camera lens choice can change perceived nose size more than almost anything you can do in real life — wide lenses distort faces up close.",
  "Jaw definition often reads differently on video than in photos, since motion reveals muscle engagement, not just static shape.",
  "Lighting angle can shift how deep-set or prominent eyes look more than makeup or grooming can.",
  "Most people rate their own left and right profile differently — that's normal facial asymmetry, not a flaw.",
  "Posture changes jaw and neck appearance more than most single grooming habits do.",
  "A relaxed, unguarded expression is judged as more symmetric on average than a tense, posed one.",
];

const QUICK_TIPS = [
  { title: 'Sleep on your back for a week', body: 'Side-sleeping compresses one cheek nightly. A week of back-sleeping usually softens morning asymmetry visibly.' },
  { title: 'Cut late-night salt', body: 'Facial puffiness is one of the fastest visible things to change — you can often see the difference within 48 hours.' },
  { title: 'SPF every morning', body: 'The single highest-leverage skin habit. Skin score climbs slowly, but this is what moves it.' },
  { title: 'Fix forward-head posture', body: 'Chin-tuck reps + phone at eye level for a month can visibly sharpen jawline without changing bone structure.' },
  { title: 'Hydrate before your next scan', body: 'A glass of water 30 min before scanning gives a cleaner, more consistent reading — especially for skin and lips.' },
  { title: 'Reduce mouth-breathing', body: 'Nasal breathing during sleep is one of the most under-rated jaw and midface habits for adults.' },
];

const WEEKLY_PLANS = [
  { title: 'This week: Symmetry focus', body: 'Sleep on your back 5 nights, chin-tuck 2×/day, and take your scan photo at the same time of day. Re-scan Sunday and compare.' },
  { title: 'This week: Skin reset', body: '3 nights of no late-night snacks, SPF every morning, and one full 8-hour sleep. Skin variance usually drops noticeably.' },
  { title: 'This week: Jaw definition', body: '2 min neck isometric holds daily, phone at eye level all week, and cut alcohol. Re-scan in 7 days.' },
  { title: 'This week: Eye area', body: 'Sleep 8h min for 4 nights, cut late salt, and scan in morning light. Under-eye readings usually shift first.' },
];

const AD_POPUPS = [
  { eyebrow: 'Try this next', title: 'Track a 7-day streak', body: 'Users who scan on the same day of the week for 3 weeks in a row see the clearest trend line — small changes get harder to miss.', ctaText: 'Start streak' },
  { eyebrow: 'New in Vysage', title: 'Compare front + side', body: 'Adding a side profile scan gives a much better jawline reading than front-only. Just tap "New scan" and go through both steps.', ctaText: 'Scan now' },
  { eyebrow: 'Share your reveal', title: 'Save it as a 1:1 GIF', body: 'Your last scan can be exported as a square GIF, perfect for stories. Open the last reveal and tap Save GIF.', ctaText: 'Got it' },
];

const UPSELL_MESSAGES = [
  { title: 'Unlock unlimited scans', body: "You're capped at 2 scans a day on Free. Pro lets you scan as often as you want — handy for tracking day-to-day changes." },
  { title: 'See your full history', body: 'Free only keeps your last 5 scans visible in Progress. Pro unlocks your complete history and trend line.' },
  { title: 'Clean exports for content', body: 'Pro removes the "vysage.app" watermark from your PNG and GIF exports — cleaner for posting.' },
  { title: 'Full protocol breakdown', body: 'Free shows your top 3 improvement areas. Pro shows the full 8-metric protocol so nothing is hidden.' },
];
const DAILY_LIMIT = 2;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const QUESTION_STEPS = ['name', 'gender', 'birthdate', 'height', 'weight', 'objectives', 'archetype'];
const STEP_ORDER = ['welcome', ...QUESTION_STEPS];

const ANALYZE_TIPS = [
  "Mapping 68 landmark points across your face…",
  "Did you know: canthal tilt is the angle of a line through your eye corners.",
  "What happens if you sleep 8 hours consistently? Under-eye puffiness and skin tone both tend to improve within weeks.",
  "Facial thirds compares brow-to-nose, nose-to-lip, and lip-to-chin distances.",
  "What happens if you stay hydrated? Skin texture readings usually get smoother, not just \"glowier.\"",
  "Symmetry scoring compares both sides of your face against your own midline — not a beauty standard.",
  "What happens if you fix forward-head posture? Your jawline can visually sharpen without changing your bone structure at all.",
  "Gonial angle is the angle at the corner of your jaw — sharper angles read as more defined.",
  "This model runs entirely on your device. Nothing is uploaded.",
  "What happens if you cut late-night salt? Morning facial puffiness is one of the first things to change.",
];

let state = {
  profile: { name: '', gender: null, birthdate: null, height: null, weight: null, goals: [], lookmax: null, archetype: null },
  streams: { front: null, side: null },
  captured: { frontCanvas: null, sideCanvas: null },
  pendingScanContext: 'onboarding',
  showAllHistory: false,
  showAllProtocols: false,
};

/* ---------------- Storage helpers ---------------- */

function loadProfile() { try { return JSON.parse(localStorage.getItem(STORAGE_PROFILE) || 'null'); } catch (e) { return null; } }
function saveProfile(p) { localStorage.setItem(STORAGE_PROFILE, JSON.stringify(p)); }
function loadScans() { try { return JSON.parse(localStorage.getItem(STORAGE_SCANS) || '[]'); } catch (e) { return []; } }
function saveScans(list) { localStorage.setItem(STORAGE_SCANS, JSON.stringify(list)); }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function getDailyState() {
  let d;
  try { d = JSON.parse(localStorage.getItem(STORAGE_DAILY) || 'null'); } catch (e) { d = null; }
  if (!d || d.date !== todayStr()) d = { date: todayStr(), count: 0 };
  return d;
}
function incrementDaily() {
  const d = getDailyState();
  d.count += 1;
  localStorage.setItem(STORAGE_DAILY, JSON.stringify(d));
  return d;
}
function remainingScansToday() {
  if (isPro()) return Infinity;
  return Math.max(0, DAILY_LIMIT - getDailyState().count);
}

function loadPlan() {
  try { return JSON.parse(localStorage.getItem(STORAGE_PLAN) || 'null') || { tier: 'free', cycle: null }; }
  catch (e) { return { tier: 'free', cycle: null }; }
}
function savePlan(p) { localStorage.setItem(STORAGE_PLAN, JSON.stringify(p)); }
function isPro() { return loadPlan().tier === 'pro'; }

/* ---------------- Onboarding ---------------- */

function showOnboardingStep(stepName) {
  $$('#onboarding .screen').forEach((el) => el.classList.add('hidden'));
  const el = $(`#onboarding .screen[data-step="${stepName}"]`);
  el.classList.remove('hidden');
  el.dataset.currentStep = stepName;
  if (el.classList.contains('ob-q')) renderStepDots(el, stepName);
}

function renderStepDots(el, stepName) {
  const idx = QUESTION_STEPS.indexOf(stepName);
  const wrap = $('.ob-progress-wrap', el);
  wrap.innerHTML = QUESTION_STEPS.map((s, i) => {
    if (i < idx) return '<i class="done"></i>';
    if (i === idx) return '<i class="current"></i>';
    return '<i></i>';
  }).join('');
}

function goToStep(stepName) { showOnboardingStep(stepName); }

function currentStepName() {
  const visible = $$('#onboarding .screen').find((el) => !el.classList.contains('hidden'));
  return visible ? visible.dataset.step : 'welcome';
}

function nextStepAfter(stepName) { const i = STEP_ORDER.indexOf(stepName); return STEP_ORDER[i + 1] || null; }
function prevStepBefore(stepName) { const i = STEP_ORDER.indexOf(stepName); return STEP_ORDER[Math.max(0, i - 1)]; }

function collectStepValue(stepName) {
  switch (stepName) {
    case 'name': state.profile.name = $('#in-name').value.trim(); break;
    case 'gender': { const sel = $('#gender-chips .chip.selected'); state.profile.gender = sel ? sel.dataset.value : null; break; }
    case 'birthdate': state.profile.birthdate = $('#in-birthdate').value || null; break;
    case 'height': {
      const v = $('#in-height').value;
      const unit = $('#height-unit .unit-btn.active').dataset.unit;
      state.profile.height = v ? { value: v, unit } : null; break;
    }
    case 'weight': {
      const v = $('#in-weight').value;
      const unit = $('#weight-unit .unit-btn.active').dataset.unit;
      state.profile.weight = v ? { value: v, unit } : null; break;
    }
    case 'objectives': {
      state.profile.goals = $$('#goal-chips .chip.selected').map((c) => c.dataset.value);
      const lm = $('#lookmax-chips .chip.selected');
      state.profile.lookmax = lm ? lm.dataset.value : null; break;
    }
    case 'archetype': {
      const sel = $('#archetype-grid .archetype-card.selected');
      state.profile.archetype = sel ? sel.dataset.value : null; break;
    }
  }
}

function clearStepValue(stepName) {
  switch (stepName) {
    case 'name': state.profile.name = ''; break;
    case 'gender': state.profile.gender = null; break;
    case 'birthdate': state.profile.birthdate = null; break;
    case 'height': state.profile.height = null; break;
    case 'weight': state.profile.weight = null; break;
    case 'objectives': state.profile.goals = []; state.profile.lookmax = null; break;
    case 'archetype': state.profile.archetype = null; break;
  }
}

function initOnboarding() {
  $$('#onboarding [data-goto]').forEach((btn) =>
    btn.addEventListener('click', () => goToStep(btn.dataset.goto)));
  $$('#onboarding [data-next]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const step = currentStepName(); collectStepValue(step); advanceFrom(step);
    }));
  $$('#onboarding [data-skip]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const step = currentStepName(); clearStepValue(step); advanceFrom(step);
    }));
  $$('#onboarding [data-back]').forEach((btn) =>
    btn.addEventListener('click', () => goToStep(prevStepBefore(currentStepName()))));

  ['gender-chips', 'lookmax-chips'].forEach((id) => {
    $$(`#${id} .chip`).forEach((chip) => {
      chip.addEventListener('click', () => {
        $$(`#${id} .chip`).forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
      });
    });
  });
  $$('#goal-chips .chip').forEach((chip) => chip.addEventListener('click', () => chip.classList.toggle('selected')));
  [$('#height-unit'), $('#weight-unit')].forEach((group) => {
    $$('.unit-btn', group).forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.unit-btn', group).forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  });
  $$('#archetype-grid .archetype-card').forEach((card) => {
    card.addEventListener('click', () => {
      $$('#archetype-grid .archetype-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });
}

function advanceFrom(step) {
  if (step === 'archetype') { finishOnboarding(); return; }
  goToStep(nextStepAfter(step));
}

function finishOnboarding() {
  saveProfile(state.profile);
  $('#onboarding').classList.add('hidden');
  state.pendingScanContext = 'onboarding';
  beginCaptureFlow();
}

/* ---------------- Capture flow ---------------- */

function showCapStep(name) {
  $$('#captureflow .screen[data-cap]').forEach((el) => el.classList.add('hidden'));
  $(`#captureflow .screen[data-cap="${name}"]`).classList.remove('hidden');
}

async function beginCaptureFlow() {
  const remaining = remainingScansToday();
  if (remaining <= 0) {
    toast(`Daily scan limit reached (${DAILY_LIMIT}/${DAILY_LIMIT}). Come back tomorrow.`);
    enterMainApp();
    return;
  }
  $('#captureflow').classList.remove('hidden');
  $('#mainapp').classList.add('hidden');
  state.captured.frontCanvas = null;
  state.captured.sideCanvas = null;
  showCapStep('front');
  await startStream('front');
}

async function startStream(which) {
  const video = $(`#video-${which}`);
  $(`#still-${which}`).classList.add('hidden');
  video.classList.remove('hidden');
  if (state.streams[which]) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $(`#frame-${which} .scan-hint`).textContent = 'Camera needs HTTPS — use Upload instead';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    state.streams[which] = stream;
    video.srcObject = stream;
  } catch (err) {
    $(`#frame-${which} .scan-hint`).textContent = 'Camera unavailable — use Upload instead';
  }
}
function stopStream(which) {
  if (state.streams[which]) {
    state.streams[which].getTracks().forEach((t) => t.stop());
    state.streams[which] = null;
  }
}
function stopAllStreams() { stopStream('front'); stopStream('side'); }

function canvasFromVideo(video) {
  if (!video.videoWidth) return null;
  const c = document.createElement('canvas');
  c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  return c;
}
function canvasFromImage(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function showFreezeFrame(which, canvas) {
  const video = $(`#video-${which}`);
  const still = $(`#still-${which}`);
  still.src = canvas.toDataURL('image/jpeg', 0.85);
  still.classList.remove('hidden');
  video.classList.add('hidden');
  return new Promise((resolve) => setTimeout(resolve, 550));
}

function initCaptureControls() {
  $('#btn-upload-front').addEventListener('click', () => $('#file-front').click());
  $('#file-front').addEventListener('change', (e) => handleUpload(e, 'front'));
  $('#btn-capture-front').addEventListener('click', async () => {
    const canvas = canvasFromVideo($('#video-front'));
    if (!canvas) return;
    state.captured.frontCanvas = canvas;
    await showFreezeFrame('front', canvas);
    stopStream('front');
    showCapStep('side');
    startStream('side');
  });

  $('#btn-upload-side').addEventListener('click', () => $('#file-side').click());
  $('#file-side').addEventListener('change', (e) => handleUpload(e, 'side'));
  $('#btn-capture-side').addEventListener('click', async () => {
    const canvas = canvasFromVideo($('#video-side'));
    if (!canvas) return;
    state.captured.sideCanvas = canvas;
    await showFreezeFrame('side', canvas);
    stopStream('side');
    runAnalyzingSequence();
  });
  $('#btn-skip-side').addEventListener('click', () => { stopStream('side'); runAnalyzingSequence(); });
}

function handleUpload(e, which) {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = async () => {
    const canvas = canvasFromImage(img);
    if (which === 'front') {
      state.captured.frontCanvas = canvas;
      await showFreezeFrame('front', canvas);
      stopStream('front');
      showCapStep('side');
      startStream('side');
    } else {
      state.captured.sideCanvas = canvas;
      await showFreezeFrame('side', canvas);
      stopStream('side');
      runAnalyzingSequence();
    }
  };
  img.src = URL.createObjectURL(file);
}

/* ---------------- Analyzing sequence ---------------- */

async function runAnalyzingSequence() {
  showCapStep('analyzing');
  const bar = $('#analyze-progress');
  const pct = $('#analyze-pct');
  const tipEl = $('#analyze-tip');

  let progress = 0;
  let tipIndex = 0;
  const shuffled = [...ANALYZE_TIPS].sort(() => Math.random() - 0.5);
  tipEl.textContent = shuffled[0];

  const tipTimer = setInterval(() => {
    tipIndex = (tipIndex + 1) % shuffled.length;
    tipEl.textContent = shuffled[tipIndex];
  }, 1300);

  const tickTo = (target, duration) => new Promise((resolve) => {
    const start = progress;
    const startTime = performance.now();
    function step(now) {
      const t = Math.min(1, (now - startTime) / duration);
      progress = start + (target - start) * t;
      bar.style.width = progress + '%';
      pct.textContent = Math.round(progress) + '%';
      if (t < 1) requestAnimationFrame(step); else resolve();
    }
    requestAnimationFrame(step);
  });

  await tickTo(30, 600);
  const ok = await ensureModelsLoaded(() => {});
  await tickTo(55, 400);

  if (!ok) {
    clearInterval(tipTimer);
    toast('Could not load models — check connection');
    showCapStep('front'); startStream('front'); return;
  }

  await tickTo(75, 500);
  let result;
  try { result = await detectFace(state.captured.frontCanvas); } catch (err) { result = null; }
  await tickTo(92, 400);

  if (!result) {
    clearInterval(tipTimer);
    toast('No face detected in front photo — try better lighting, face centered');
    showCapStep('front'); startStream('front'); return;
  }

  const analysis = analyzeLandmarks(result.landmarks, state.captured.frontCanvas);
  const frontThumb = shrinkToThumb(state.captured.frontCanvas, 240);
  const sideThumb = state.captured.sideCanvas ? shrinkToThumb(state.captured.sideCanvas, 240) : null;

  const record = {
    date: new Date().toISOString(),
    overall: analysis.overall,
    potential: analysis.potential,
    metrics: analysis.metrics,
    landmarkPoints: analysis.landmarkPoints,
    imageSize: analysis.imageSize,
    thumb: shrinkToThumb(state.captured.frontCanvas, 120),
    frontThumb, sideThumb,
  };
  const scans = loadScans();
  scans.push(record);
  saveScans(scans);
  incrementDaily();

  await tickTo(100, 300);
  clearInterval(tipTimer);
  setTimeout(() => renderReveal(record), 200);
}

function shrinkToThumb(canvas, size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const s = Math.min(canvas.width, canvas.height);
  const sx = (canvas.width - s) / 2, sy = (canvas.height - s) / 2;
  ctx.drawImage(canvas, sx, sy, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.7);
}

/* ---------------- Reveal screen ---------------- */

function renderReveal(record) {
  showCapStep('reveal');
  const el = $('#reveal-screen');
  const pts = record.landmarkPoints;
  const { w, h } = record.imageSize;

  let overlaySvg = '';
  if (pts && w) {
    const dots = pts.map((p) => `<circle cx="${(p.x / w) * 100}%" cy="${(p.y / h) * 100}%" r="1.6" fill="#37E5FF" opacity="0.85"/>`).join('');
    overlaySvg = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;">${dots}</svg>`;
  }

  const metricEntries = Object.values(record.metrics);

  el.innerHTML = `
    <div class="reveal-wrap" id="reveal-capture-target">
      <p class="reveal-title">Vysage · Scan Result</p>
      <div class="reveal-photo-ring">
        <img src="${record.frontThumb}" />
        ${overlaySvg}
      </div>
      <div class="reveal-brand"><span class="dot"></span><span>Vysage</span></div>
      <div class="reveal-score-row">
        <span class="big" id="reveal-count">0.0</span>
        <span class="of10">/ 10 · ${tierFor(record.overall).label}</span>
      </div>
      <div class="reveal-grid" id="reveal-grid"></div>
      <p class="reveal-tag">${isPro() ? 'Vysage Pro' : 'vysage.app'}</p>
    </div>
    <div class="reveal-actions">
      <button class="btn btn-secondary" id="btn-download-reveal" style="flex:1">Save PNG</button>
      <button class="btn btn-secondary vy-pulse" id="btn-download-gif" style="flex:1">Save GIF</button>
    </div>
    <div class="ob-actions" style="padding-top:10px;">
      <button class="btn btn-primary vy-pulse" id="btn-reveal-continue" style="width:100%">Continue</button>
    </div>
  `;

  const grid = $('#reveal-grid', el);
  metricEntries.forEach((m, i) => {
    const card = document.createElement('div');
    card.className = 'reveal-card';
    card.style.animationDelay = `${0.4 + i * 0.06}s`;
    card.innerHTML = `
      <div class="r-name">${m.label}</div>
      <div class="r-val" data-target="${Math.round(m.score * 10)}">0</div>
      <div class="reveal-bar-track"><div class="reveal-bar-fill" data-width="${m.score * 10}"></div></div>
    `;
    grid.appendChild(card);
  });

  animateCountUp($('#reveal-count', el), record.overall);
  setTimeout(() => {
    $$('.reveal-card .r-val', el).forEach((v) => animateCountUp(v, parseInt(v.dataset.target, 10) / 10));
    $$('.reveal-bar-fill', el).forEach((b) => { b.style.width = b.dataset.width + '%'; });
  }, 500);

  $('#btn-reveal-continue').addEventListener('click', () => {
    stopAllStreams();
    const scanCount = loadScans().length;
    const shouldUpsell = !isPro() && scanCount > 0 && scanCount % 3 === 0;
    enterMainApp();
    if (shouldUpsell) setTimeout(() => showUpsellModal(), 450);
  });
  $('#btn-download-reveal').addEventListener('click', () => downloadReveal());
  $('#btn-download-gif').addEventListener('click', () => downloadRevealGif(record));
}

function animateCountUp(el, target) {
  const duration = 900;
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = (target * eased).toFixed(1);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function downloadReveal() {
  const target = $('#reveal-capture-target');
  if (!window.html2canvas) { toast('Image export unavailable offline'); return; }

  const btn = $('#btn-download-reveal');
  const originalLabel = btn.textContent;
  btn.textContent = 'Preparing…';
  btn.disabled = true;

  const animated = target.querySelectorAll(
    '.reveal-title, .reveal-photo-ring, .reveal-brand, .reveal-score-row, .reveal-card, .reveal-tag'
  );
  animated.forEach((el) => {
    el.style.animation = 'none'; el.style.opacity = '1'; el.style.transform = 'none';
  });
  target.querySelectorAll('.reveal-bar-fill').forEach((bar) => {
    bar.style.transition = 'none';
    bar.style.width = bar.dataset.width + '%';
  });

  const finalizeAndCapture = () => {
    html2canvas(target, { backgroundColor: '#04060B', scale: 2, useCORS: true, logging: false })
      .then((canvas) => {
        const link = document.createElement('a');
        link.download = `vysage-result-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      })
      .catch(() => toast('Could not export image'))
      .finally(() => {
        btn.textContent = originalLabel; btn.disabled = false;
        animated.forEach((el) => { el.style.animation = ''; el.style.opacity = ''; el.style.transform = ''; });
      });
  };

  const img = target.querySelector('.reveal-photo-ring img');
  if (img && !img.complete) {
    img.addEventListener('load', finalizeAndCapture, { once: true });
    img.addEventListener('error', finalizeAndCapture, { once: true });
  } else if (img && img.decode) {
    img.decode().then(finalizeAndCapture).catch(finalizeAndCapture);
  } else {
    requestAnimationFrame(() => requestAnimationFrame(finalizeAndCapture));
  }
}

/* ---------------- GIF export ---------------- */

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function revealTimelineItems(cardCount) {
  const items = [
    { selector: '.reveal-title', delay: 0, dur: 500, type: 'fade' },
    { selector: '.reveal-photo-ring', delay: 150, dur: 600, type: 'pop' },
    { selector: '.reveal-brand', delay: 300, dur: 500, type: 'fade' },
    { selector: '.reveal-score-row', delay: 350, dur: 500, type: 'fade' },
    { selector: '.reveal-tag', delay: 500, dur: 500, type: 'fade' },
  ];
  for (let i = 0; i < cardCount; i++) {
    items.push({ selector: `#reveal-grid .reveal-card:nth-child(${i + 1})`, delay: 400 + i * 60, dur: 450, type: 'fade' });
  }
  return items;
}

function applyRevealFrame(target, timeMs, timelineItems, overallScore, metricEntries) {
  timelineItems.forEach((item) => {
    target.querySelectorAll(item.selector).forEach((el) => {
      const localT = clamp01((timeMs - item.delay) / item.dur);
      if (timeMs < item.delay) {
        el.style.opacity = '0';
        el.style.transform = item.type === 'pop' ? 'scale(0.85)' : 'translateY(10px)';
        return;
      }
      if (item.type === 'pop') {
        const e = easeOutBack(localT);
        el.style.opacity = clamp01(localT / 0.5);
        el.style.transform = `scale(${0.85 + 0.15 * e})`;
      } else {
        const e = easeOutCubic(localT);
        el.style.opacity = e;
        el.style.transform = `translateY(${(1 - e) * 10}px)`;
      }
    });
  });
  const scoreT = clamp01(timeMs / 900);
  const countEl = target.querySelector('#reveal-count');
  if (countEl) countEl.textContent = (overallScore * easeOutCubic(scoreT)).toFixed(1);

  const barsT = clamp01((timeMs - 500) / 900);
  const barsEase = easeOutCubic(barsT);
  target.querySelectorAll('#reveal-grid .reveal-card').forEach((card, i) => {
    const m = metricEntries[i];
    if (!m) return;
    const valEl = card.querySelector('.r-val');
    const barEl = card.querySelector('.reveal-bar-fill');
    if (valEl) valEl.textContent = (m.score * barsEase).toFixed(1);
    if (barEl) { barEl.style.transition = 'none'; barEl.style.width = (m.score * 10 * barsEase) + '%'; }
  });
}

// Load gif.js worker script into a same-origin blob URL. The cross-origin
// worker load from jsdelivr is the #1 cause of "stuck at 94%" — the frames
// finish encoding but the worker never posts back because it silently 404ed.
async function prepareGifWorker() {
  const WORKER_URL = 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js';
  try {
    const res = await fetch(WORKER_URL, { cache: 'force-cache' });
    if (!res.ok) return null;
    const text = await res.text();
    const blob = new Blob([text], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
  } catch (e) {
    return null;
  }
}

async function downloadRevealGif(record) {
  if (!window.html2canvas) { toast('GIF export needs a connection to load the renderer'); return; }
  if (!window.GIF) { toast('GIF export needs a connection to load the encoder'); return; }

  const target = $('#reveal-capture-target');
  const btn = $('#btn-download-gif');
  const otherBtn = $('#btn-download-reveal');
  const originalLabel = btn.textContent;
  btn.disabled = true; otherBtn.disabled = true;
  btn.textContent = 'Preparing…';

  const metricEntries = Object.values(record.metrics);
  const timelineItems = revealTimelineItems(metricEntries.length);

  const animated = target.querySelectorAll('.reveal-title, .reveal-photo-ring, .reveal-brand, .reveal-score-row, .reveal-card, .reveal-tag');
  animated.forEach((el) => { el.style.animation = 'none'; });

  const TOTAL_MS = 1400;
  const FRAME_MS = 100;
  const frameCount = Math.ceil(TOTAL_MS / FRAME_MS);

  // Force a square 1:1 output
  const srcW = target.offsetWidth;
  const srcH = target.offsetHeight;
  const outSize = Math.min(srcW, srcH);

  const workerBlobUrl = await prepareGifWorker();

  const gifOpts = {
    quality: 12,
    width: outSize,
    height: outSize,
    workers: workerBlobUrl ? 2 : 0,
  };
  if (workerBlobUrl) gifOpts.workerScript = workerBlobUrl;

  const gif = new GIF(gifOpts);

  // Two-phase progress: 0-70% = frame capture, 70-100% = encoding
  const setCapturePct = (f) => {
    const p = Math.round((f / frameCount) * 70);
    btn.textContent = `Capturing… ${p}%`;
  };
  gif.on('progress', (p) => {
    const encPct = 70 + Math.round(p * 30);
    btn.textContent = `Encoding… ${encPct}%`;
  });

  // 45s watchdog — abort a hung render so the button never stays stuck.
  let watchdog = setTimeout(() => {
    try { gif.abort && gif.abort(); } catch (e) {}
    toast('GIF render took too long — try again on a stronger connection');
    restore();
  }, 45000);

  const restore = () => {
    clearTimeout(watchdog);
    animated.forEach((el) => { el.style.animation = ''; el.style.opacity = ''; el.style.transform = ''; });
    target.querySelectorAll('.reveal-bar-fill').forEach((b) => { b.style.transition = ''; });
    btn.textContent = originalLabel;
    btn.disabled = false; otherBtn.disabled = false;
    if (workerBlobUrl) setTimeout(() => URL.revokeObjectURL(workerBlobUrl), 5000);
  };

  try {
    // Reusable square canvas for center-cropping each html2canvas frame → 1:1.
    const squareCanvas = document.createElement('canvas');
    squareCanvas.width = outSize; squareCanvas.height = outSize;
    const squareCtx = squareCanvas.getContext('2d');

    for (let f = 0; f < frameCount; f++) {
      const t = f * FRAME_MS;
      applyRevealFrame(target, t, timelineItems, record.overall, metricEntries);
      await new Promise((r) => requestAnimationFrame(r));
      const frame = await html2canvas(target, { backgroundColor: '#04060B', scale: 1, logging: false });
      const sx = Math.max(0, (frame.width - outSize) / 2);
      const sy = Math.max(0, (frame.height - outSize) / 2);
      squareCtx.fillStyle = '#04060B';
      squareCtx.fillRect(0, 0, outSize, outSize);
      squareCtx.drawImage(frame, sx, sy, outSize, outSize, 0, 0, outSize, outSize);
      gif.addFrame(squareCanvas, { delay: FRAME_MS, copy: true });
      setCapturePct(f + 1);
    }
    // Hold the finished frame briefly, but no giant 1100ms tail (that was
    // what made the last percent seem endless).
    applyRevealFrame(target, TOTAL_MS, timelineItems, record.overall, metricEntries);
    await new Promise((r) => requestAnimationFrame(r));
    const lastFrame = await html2canvas(target, { backgroundColor: '#04060B', scale: 1, logging: false });
    const sxL = Math.max(0, (lastFrame.width - outSize) / 2);
    const syL = Math.max(0, (lastFrame.height - outSize) / 2);
    squareCtx.fillStyle = '#04060B';
    squareCtx.fillRect(0, 0, outSize, outSize);
    squareCtx.drawImage(lastFrame, sxL, syL, outSize, outSize, 0, 0, outSize, outSize);
    gif.addFrame(squareCanvas, { delay: 500, copy: true });

    await new Promise((resolve, reject) => {
      gif.on('finished', (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `vysage-result-${Date.now()}.gif`;
        link.href = url; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        resolve();
      });
      gif.on('abort', () => reject(new Error('GIF render aborted')));
      gif.render();
    });
    toast('GIF saved (1:1)');
  } catch (err) {
    console.error(err);
    toast('Could not export GIF — try again');
  } finally {
    restore();
  }
}

/* ---------------- Main app ---------------- */

function enterMainApp() {
  $('#onboarding').classList.add('hidden');
  $('#captureflow').classList.add('hidden');
  $('#mainapp').classList.remove('hidden');
  const p = loadProfile();
  $('#greet-text').textContent = p && p.name ? p.name.toUpperCase() : '';
  switchView('dashboard');
  scheduleAmbientPopups();
}

function initNav() {
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
    switchView(tab.dataset.view);
    if (tab.dataset.view === 'dashboard') maybeShowAmbientPopup();
  }));
  $('#btn-empty-scan').addEventListener('click', () => startNewScan());
  $('#btn-new-scan').addEventListener('click', () => startNewScan());
}

function startNewScan() {
  if (!isPro() && remainingScansToday() <= 0) {
    showModal({
      eyebrow: 'Daily limit reached',
      title: "You've used today's free scans",
      body: 'Free includes 2 scans a day. Go Pro for unlimited scans, so you can track changes as often as you like.',
      ctaText: 'See Vysage Pro',
      onCta: () => switchView('plans'),
      dismissText: 'Maybe later',
    });
    return;
  }
  state.pendingScanContext = 'dashboard';
  beginCaptureFlow();
}

function switchView(name) {
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${name}`).classList.remove('hidden');
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  if (name === 'dashboard') renderDashboard();
  if (name === 'progress') renderProgress();
  if (name === 'profile') renderProfileView();
  if (name === 'plans') renderPlansScreen();
}

/* ---------------- Toast + dashboard ---------------- */

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function renderDashboard() {
  const scans = loadScans();
  const remaining = remainingScansToday();
  $('#link-scan-limit').textContent = isPro() ? 'Unlimited scans · Pro' : `${remaining}/${DAILY_LIMIT} scans left today`;

  if (!scans.length) {
    $('#dashboard-empty').classList.remove('hidden');
    $('#dashboard-content').classList.add('hidden');
    return;
  }
  $('#dashboard-empty').classList.add('hidden');
  $('#dashboard-content').classList.remove('hidden');

  const best = scans.reduce((a, b) => (b.overall > a.overall ? b : a), scans[0]);
  const tierInfo = tierFor(best.overall);

  $('#score-overall').textContent = best.overall.toFixed(1);
  $('#score-tier').textContent = tierInfo.tier;
  $('#score-label').textContent = tierInfo.label;
  $('#score-potential').textContent = `Potential ${best.potential.toFixed(1)} · ${scans.length} scan${scans.length > 1 ? 's' : ''} logged`;

  const circumference = 2 * Math.PI * 46;
  const offset = circumference - (best.overall / 10) * circumference;
  $('#ring-fill').setAttribute('stroke-dasharray', circumference.toFixed(1));
  $('#ring-fill').setAttribute('stroke-dashoffset', offset.toFixed(1));

  renderMetricGrid(best.metrics);
  renderBlueprint(best);
  renderProtocols(best.metrics);

  $('#btn-new-scan').disabled = false;
  $('#btn-new-scan').textContent = (!isPro() && remaining <= 0) ? 'Daily limit reached · Go Pro' : 'New scan';
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
  if (!pts || !w || pts.length < 68) { svg.innerHTML = ''; return; }

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

// Score-tiered protocols so tips actually reflect the metric's state.
const PROTOCOL_LIBRARY = {
  canthalTilt: {
    tag: 'Eyes',
    focus: 'Under-eye area reads tired. Sleep 8h, cut late salt, and lower phone brightness at night — you should see a shift in a week.',
    refine: 'Sleep position matters most here. Two weeks of back-sleeping usually softens under-eye puffiness visibly.',
    maintain: 'Eye-area proportions are strong. Keep the sleep + hydration baseline and it stays there.',
  },
  jawline: {
    focus: 'Jawline reads soft in this frame. Two weeks of 2min chin-tuck holds, nasal breathing, and phone at eye level makes a real difference.',
    refine: 'Solid jaw definition. Reduce alcohol + late salt for one week to sharpen it further and re-scan.',
    maintain: 'Strong jawline definition. Posture + nasal breathing keep it there.',
    tag: 'Jawline',
  },
  symmetry: {
    focus: 'Try scanning in even, front-on lighting at the same time of day — some of this is camera, not structure. Then focus on sleep-side rotation.',
    refine: 'Minor asymmetry, likely posture and sleep-side related. Rotate sleep sides through the week.',
    maintain: 'Symmetry is excellent. Consistent scan lighting will keep this reading clean.',
    tag: 'Symmetry',
  },
  skin: {
    focus: 'Skin is your biggest lever. Daily SPF, 8h sleep, and one week off alcohol usually move this score more than a full skincare routine.',
    refine: 'Clean skin baseline. A simple cleanse-moisturize-SPF loop nudges it up further.',
    maintain: 'Skin metrics are strong. Keep SPF + sleep steady.',
    tag: 'Skin',
  },
  midface: {
    focus: 'Midface proportion is largely bone structure. Tracking it consistently over time gives a truer read than any single scan.',
    refine: 'Midface reads within normal range. Consistent lighting on future scans will keep the trend honest.',
    maintain: 'Balanced midface proportions.',
    tag: 'Midface',
  },
  nose: {
    focus: 'Wide-angle phone lenses distort noses when you shoot close. Re-scan from arm\'s length for a truer reading.',
    refine: 'Nose proportion is close to reference. Camera distance matters a lot — keep it consistent.',
    maintain: 'Well-proportioned nose reading.',
    tag: 'Nose',
  },
  eyes: {
    focus: 'Sleep quality + hydration move under-eye reading fastest. 4 nights of 8h sleep usually shows up in the next scan.',
    refine: 'Eye spacing is close to reference. Sleep + hydration keep the surrounding area clean.',
    maintain: 'Eye area reads strong.',
    tag: 'Eyes',
  },
  lips: {
    focus: 'Hydration + lip balm week can change perceived fullness more than most people expect. Try it and re-scan.',
    refine: 'Solid lip proportion. Keep hydration steady.',
    maintain: 'Well-proportioned lip reading.',
    tag: 'Lips',
  },
};

function protocolBucket(score) {
  if (score < 6) return 'focus';
  if (score < 7.5) return 'refine';
  return 'maintain';
}

function renderProtocols(metrics) {
  const list = $('#protocol-list');
  list.innerHTML = '';
  const sorted = Object.entries(metrics).sort((a, b) => a[1].score - b[1].score);
  const shown = state.showAllProtocols ? sorted.slice(0, isPro() ? sorted.length : 3)
                                       : sorted.slice(0, PROTOCOL_PREVIEW);

  shown.forEach(([key, m]) => {
    const lib = PROTOCOL_LIBRARY[key] || { tag: m.label, focus: 'Track this metric over successive scans.', refine: '', maintain: '' };
    const bucket = protocolBucket(m.score);
    const text = lib[bucket] || lib.focus || '';
    const div = document.createElement('div');
    div.className = 'protocol-card vy-fade-in';
    div.innerHTML = `
      <div class="p-top">
        <h4>${m.label} <span style="opacity:.5;font-size:12px;">· ${m.score.toFixed(1)}</span></h4>
        <span class="tag">${lib.tag}</span>
      </div>
      <p>${text}</p>
    `;
    list.appendChild(div);
  });

  const totalAvailable = isPro() ? sorted.length : Math.min(3, sorted.length);
  if (totalAvailable > shown.length || (state.showAllProtocols && totalAvailable > PROTOCOL_PREVIEW)) {
    const toggle = document.createElement('button');
    toggle.className = 'btn btn-secondary vy-inline-toggle';
    toggle.textContent = state.showAllProtocols
      ? 'Show less'
      : `Show ${totalAvailable - shown.length} more tip${totalAvailable - shown.length > 1 ? 's' : ''}`;
    toggle.addEventListener('click', () => {
      state.showAllProtocols = !state.showAllProtocols;
      renderProtocols(metrics);
    });
    list.appendChild(toggle);
  }
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
  svg.innerHTML = `<polyline points="${pts.join(' ')}" fill="none" stroke="#3EB8A6" stroke-width="1.6"/>${dots}`;

  const reversed = [...scans].reverse();
  const pro = isPro();
  const cap = pro ? reversed.length : FREE_HISTORY_LIMIT;
  const visibleAll = reversed.slice(0, cap);
  const visible = state.showAllHistory ? visibleAll : visibleAll.slice(0, HISTORY_PREVIEW);

  visible.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'history-row vy-fade-in';
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

  if (visibleAll.length > HISTORY_PREVIEW) {
    const toggle = document.createElement('button');
    toggle.className = 'btn btn-secondary vy-inline-toggle';
    toggle.textContent = state.showAllHistory
      ? 'Show less'
      : `Show all ${visibleAll.length} scans`;
    toggle.addEventListener('click', () => {
      state.showAllHistory = !state.showAllHistory;
      renderProgress();
    });
    historyList.appendChild(toggle);
  }

  if (!pro && reversed.length > FREE_HISTORY_LIMIT) {
    const hidden = reversed.length - FREE_HISTORY_LIMIT;
    const nudge = document.createElement('div');
    nudge.className = 'upsell-row';
    nudge.innerHTML = `${hidden} earlier scan${hidden > 1 ? 's' : ''} hidden on Free · <a id="link-history-upsell">Upgrade to Pro</a>`;
    historyList.appendChild(nudge);
    $('#link-history-upsell').addEventListener('click', () => switchView('plans'));
  }
}

/* ---------------- Profile view ---------------- */

const GOAL_LABELS = { jawline: 'Jawline', skin: 'Skin', symmetry: 'Symmetry', posture: 'Posture', curious: 'Curious' };
const GENDER_LABELS = { male: 'Male', female: 'Female', nonbinary: 'Non-binary' };
const LOOKMAX_LABELS = { neutral: 'Neutral', soft: 'Softmaxxing', hard: 'Hardmaxxing', experimental: 'Experimental' };
const ARCHETYPE_LABELS = { chiseled: 'Classic Chiseled', softboy: 'Soft & Boyish', editorial: 'Sculpted Editorial', rugged: 'Rugged Angular', natural: 'Natural Balance' };

function calcAge(birthdate) {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

function renderProfileView() {
  const p = loadProfile();
  if (!p) return;
  renderPlanCard();
  $('#p-name').textContent = p.name || '—';
  $('#p-gender').textContent = GENDER_LABELS[p.gender] || '—';
  const age = calcAge(p.birthdate);
  $('#p-age').textContent = age !== null ? `${age}` : '—';
  $('#p-height').textContent = p.height ? `${p.height.value} ${p.height.unit}` : '—';
  $('#p-weight').textContent = p.weight ? `${p.weight.value} ${p.weight.unit}` : '—';
  $('#p-lookmax').textContent = LOOKMAX_LABELS[p.lookmax] || '—';
  $('#p-goals').textContent = (p.goals && p.goals.length) ? p.goals.map((g) => GOAL_LABELS[g] || g).join(', ') : '—';
  $('#p-archetype').textContent = ARCHETYPE_LABELS[p.archetype] || '—';
  $('#p-count').textContent = loadScans().length;
  const d = getDailyState();
  $('#p-today').textContent = isPro() ? `${d.count} (Unlimited)` : `${d.count} / ${DAILY_LIMIT}`;
}

function initProfileActions() {
  $('#btn-reset').addEventListener('click', () => {
    if (confirm('Erase your profile and all scan history from this device? This cannot be undone.')) {
      localStorage.removeItem(STORAGE_PROFILE);
      localStorage.removeItem(STORAGE_SCANS);
      localStorage.removeItem(STORAGE_DAILY);
      localStorage.removeItem(STORAGE_PLAN);
      location.reload();
    }
  });
}

/* ---------------- Modal + rotating popups ---------------- */

function showModal({ eyebrow, title, body, ctaText, onCta, dismissText, onDismiss }) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay vy-modal-in';
  overlay.id = 'active-modal';
  overlay.innerHTML = `
    <div class="modal-card vy-modal-pop">
      ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}
      <h3>${title}</h3>
      <p>${body}</p>
      <div class="modal-actions">
        ${dismissText ? `<button class="btn btn-secondary" id="modal-dismiss">${dismissText}</button>` : ''}
        <button class="btn btn-primary vy-pulse" id="modal-cta" style="${dismissText ? '' : 'width:100%'}">${ctaText}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  $('#modal-cta').addEventListener('click', () => { closeModal(); if (onCta) onCta(); });
  if (dismissText) {
    $('#modal-dismiss').addEventListener('click', () => { closeModal(); if (onDismiss) onDismiss(); });
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
}
function closeModal() {
  const existing = document.getElementById('active-modal');
  if (existing) existing.remove();
}

function shouldShowThrottledPopup(key, cooldownMs) {
  const last = parseInt(localStorage.getItem(key) || '0', 10);
  return (Date.now() - last) > cooldownMs;
}
function markThrottledPopupShown(key) { localStorage.setItem(key, String(Date.now())); }

// Rotating pop-up registry — each entry decides if it should fire, and
// what to show. The scheduler picks one eligible entry at random.
function popupRegistry() {
  const scans = loadScans();
  const daily = getDailyState();
  const scannedToday = daily.count > 0;
  const pro = isPro();
  return [
    {
      key: 'vysage_pop_dailyreminder_v1', cooldown: 20 * 60 * 60 * 1000,
      eligible: () => !scannedToday && scans.length > 0,
      build: () => ({
        eyebrow: 'Daily reminder',
        title: `Time for today's scan, ${(loadProfile()?.name || 'champ').split(' ')[0]}`,
        body: 'Same time of day, same lighting = the cleanest trend line. It takes ~30 seconds.',
        ctaText: 'Scan now', onCta: startNewScan, dismissText: 'Later',
      }),
    },
    {
      key: 'vysage_pop_weekly_v1', cooldown: 3 * 24 * 60 * 60 * 1000,
      eligible: () => scans.length >= 1,
      build: () => {
        const plan = WEEKLY_PLANS[Math.floor(Math.random() * WEEKLY_PLANS.length)];
        return { eyebrow: 'This week\'s plan', title: plan.title, body: plan.body,
                 ctaText: 'Got it', dismissText: 'Skip' };
      },
    },
    {
      key: 'vysage_pop_tip_v1', cooldown: 5 * 60 * 60 * 1000,
      eligible: () => true,
      build: () => {
        const tip = QUICK_TIPS[Math.floor(Math.random() * QUICK_TIPS.length)];
        return { eyebrow: 'Quick tip', title: tip.title, body: tip.body, ctaText: 'Try it' };
      },
    },
    {
      key: 'vysage_pop_fact_v1', cooldown: 6 * 60 * 60 * 1000,
      eligible: () => true,
      build: () => {
        const fact = FUN_FACTS[Math.floor(Math.random() * FUN_FACTS.length)];
        return { eyebrow: 'Did you know', title: 'A quick fact', body: fact, ctaText: 'Got it' };
      },
    },
    {
      key: 'vysage_pop_ad_v1', cooldown: 8 * 60 * 60 * 1000,
      eligible: () => true,
      build: () => {
        const ad = AD_POPUPS[Math.floor(Math.random() * AD_POPUPS.length)];
        return { eyebrow: ad.eyebrow, title: ad.title, body: ad.body, ctaText: ad.ctaText };
      },
    },
    {
      key: 'vysage_pop_upsell_v1', cooldown: 10 * 60 * 60 * 1000,
      eligible: () => !pro && scans.length >= 2,
      build: () => {
        const msg = UPSELL_MESSAGES[Math.floor(Math.random() * UPSELL_MESSAGES.length)];
        return { eyebrow: 'Vysage Pro', title: msg.title, body: msg.body,
                 ctaText: 'See Vysage Pro', onCta: () => switchView('plans'),
                 dismissText: 'Not now' };
      },
    },
    {
      key: 'vysage_pop_streak_v1', cooldown: 4 * 24 * 60 * 60 * 1000,
      eligible: () => scans.length >= 3,
      build: () => ({
        eyebrow: `${scans.length} scans logged`,
        title: 'Your trend line is getting real',
        body: 'The more consistent your scans, the more real the changes read. Aim for one scan per day this week.',
        ctaText: 'Nice',
      }),
    },
  ];
}

function maybeShowAmbientPopup() {
  if (document.getElementById('active-modal')) return;
  const eligible = popupRegistry().filter((p) =>
    p.eligible() && shouldShowThrottledPopup(p.key, p.cooldown));
  if (!eligible.length) return;
  // 55% chance of firing when eligible — not on every dashboard visit.
  if (Math.random() > 0.55) return;
  const pick = eligible[Math.floor(Math.random() * eligible.length)];
  markThrottledPopupShown(pick.key);
  showModal(pick.build());
}

let ambientTimer = null;
function scheduleAmbientPopups() {
  if (ambientTimer) clearInterval(ambientTimer);
  // Try again every 90s while the user is active on the app.
  ambientTimer = setInterval(() => {
    if (document.hidden) return;
    const activeView = $$('.view').find((v) => !v.classList.contains('hidden'));
    if (!activeView || activeView.id !== 'view-dashboard') return;
    maybeShowAmbientPopup();
  }, 90000);
  // First-fire slightly delayed after entering the app.
  setTimeout(maybeShowAmbientPopup, 2500);
}

function showUpsellModal() {
  const msg = UPSELL_MESSAGES[Math.floor(Math.random() * UPSELL_MESSAGES.length)];
  showModal({
    eyebrow: 'Vysage Pro',
    title: msg.title, body: msg.body,
    ctaText: 'See Vysage Pro',
    onCta: () => switchView('plans'),
    dismissText: 'Not now',
  });
}

/* ---------------- Plans / subscription ---------------- */

function renderPlansScreen() {
  const plan = loadPlan();
  const cycle = plan.cycle || 'monthly';
  $$('#billing-toggle .chip').forEach((c) => c.classList.toggle('selected', c.dataset.cycle === cycle));
  const pricing = PLAN_PRICING[cycle];
  $('#price-big').textContent = pricing.big;
  $('#price-sub').textContent = pricing.sub;

  const compare = $('#feature-compare');
  compare.innerHTML = `
    <div class="compare-head"><span></span><span style="text-align:center;">Free</span><span class="ch-pro" style="text-align:center;">Pro</span></div>
    ${PLAN_FEATURES.map((f) => `
      <div class="compare-row">
        <span class="cr-label">${f.label}</span>
        <span class="cr-free">${f.free}</span>
        <span class="cr-pro">${f.pro}</span>
      </div>
    `).join('')}
  `;

  const isP = plan.tier === 'pro';
  $('#btn-upgrade').classList.toggle('hidden', isP);
  $('#pro-manage-block').classList.toggle('hidden', !isP);
}

function initPlans() {
  $('#btn-open-plans').addEventListener('click', () => switchView('plans'));
  $('#link-plans-back').addEventListener('click', () => switchView('profile'));

  $$('#billing-toggle .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $$('#billing-toggle .chip').forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
      const pricing = PLAN_PRICING[chip.dataset.cycle];
      $('#price-big').textContent = pricing.big;
      $('#price-sub').textContent = pricing.sub;
    });
  });

  $('#btn-upgrade').addEventListener('click', async () => {
    const cycle = $('#billing-toggle .chip.selected').dataset.cycle;
    const btn = $('#btn-upgrade');
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = 'Redirecting…';
    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cycle }),
      });
      if (!res.ok) throw new Error(`checkout request failed (${res.status})`);
      const data = await res.json();
      if (!data.url) throw new Error('no checkout url returned');
      window.location.href = data.url;
      return;
    } catch (err) {
      console.warn('Stripe checkout unavailable, using local simulated upgrade instead:', err);
      savePlan({ tier: 'pro', cycle });
      toast('Welcome to Vysage Pro (simulated — Stripe not connected yet)');
      renderPlansScreen(); renderPlanCard();
    }
    btn.disabled = false; btn.textContent = original;
  });

  $('#btn-downgrade').addEventListener('click', async () => {
    const plan = loadPlan();
    if (!plan.customerId) {
      if (confirm('Reset to Free? (No live Stripe subscription on file — this only clears the local demo flag.)')) {
        savePlan({ tier: 'free', cycle: null });
        toast('Back to Free');
        renderPlansScreen(); renderPlanCard();
      }
      return;
    }
    const btn = $('#btn-downgrade');
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = 'Opening billing portal…';
    try {
      const res = await fetch('/api/create-portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: plan.customerId }),
      });
      if (!res.ok) throw new Error(`portal request failed (${res.status})`);
      const data = await res.json();
      if (!data.url) throw new Error('no portal url returned');
      window.location.href = data.url;
      return;
    } catch (err) {
      console.error('billing portal error', err);
      toast('Could not open billing portal');
    }
    btn.disabled = false; btn.textContent = original;
  });
}

/* ---------------- Stripe checkout return ---------------- */

async function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get('checkout');
  if (!checkout) return;
  if (checkout === 'success') {
    const sessionId = params.get('session_id');
    try {
      const res = await fetch(`/api/verify-session?session_id=${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      if (data.pro) {
        savePlan({ tier: 'pro', cycle: data.cycle, customerId: data.customerId, subscriptionId: data.subscriptionId });
        toast('Welcome to Vysage Pro');
      } else {
        toast('Payment not confirmed yet — check your email or try again');
      }
    } catch (err) {
      console.error('verify-session failed', err);
      toast('Could not confirm payment — contact support if you were charged');
    }
  }
  window.history.replaceState({}, '', window.location.pathname);
}

async function reverifyProStatus() {
  const plan = loadPlan();
  if (plan.tier !== 'pro' || !plan.customerId) return;
  try {
    const res = await fetch(`/api/check-subscription?customer_id=${encodeURIComponent(plan.customerId)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.pro) savePlan({ tier: 'free', cycle: null });
    else if (data.cycle && data.cycle !== plan.cycle) savePlan({ ...plan, cycle: data.cycle });
  } catch (err) {
    console.warn('Could not re-verify subscription status', err);
  }
}

function renderPlanCard() {
  const plan = loadPlan();
  const isP = plan.tier === 'pro';
  $('#plan-badge-profile').textContent = isP ? 'PRO' : 'FREE';
  $('#plan-badge-profile').classList.toggle('is-pro', isP);
  $('#plan-card-title').textContent = isP ? "You're on Pro" : "You're on Free";
  $('#plan-card-sub').textContent = isP
    ? 'Unlimited scans, full history, and watermark-free exports are active.'
    : 'Unlock unlimited scans, full history, and watermark-free exports.';
  $('#btn-open-plans').textContent = isP ? 'Manage plan' : 'See Vysage Pro';
}

/* ---------------- Boot ---------------- */

async function boot() {
  initOnboarding();
  initCaptureControls();
  initNav();
  initProfileActions();
  initPlans();

  await handleCheckoutReturn();
  await reverifyProStatus();

  const existing = loadProfile();
  if (existing) { state.profile = existing; enterMainApp(); }
  else { goToStep('welcome'); }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', boot);