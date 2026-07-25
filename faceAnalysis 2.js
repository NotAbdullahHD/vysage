/* ============================================================
   Vysage — Face geometry analysis (v3 recalibrated)
   Uses face-api.js (tiny face detector + 68pt landmark model)
   entirely client-side. Scoring below is a proportion-based
   heuristic — not a scientific or medical measurement.

   v3 changes vs v2:
   - Softer deviation curve so well-proportioned faces (e.g. a
     clean athlete headshot) actually land in the 7.5-8.8 band
     instead of getting mashed down to a mid-5.
   - Multi-pass detector (tries 512 → 416 → 320) so tighter
     framings and lower-contrast photos still register.
   - Symmetry uses nose-bridge midline (not chin midpoint) and
     accounts for both horizontal AND vertical eye offset.
   - Facial-thirds ratio added into midface score.
   - Skin score samples 4 patches (forehead, both cheeks, chin)
     for smoothness + tone-evenness instead of just 2 cheeks.
   - Overall gets a small "harmony bonus" when many metrics
     agree — mirrors how humans read faces (consistency > any
     single number).
   ============================================================ */

const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js/weights';

let modelsReady = false;

async function ensureModelsLoaded(onProgress) {
  if (modelsReady) return true;
  try {
    onProgress && onProgress('Loading detector…');
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    onProgress && onProgress('Loading landmark map…');
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    modelsReady = true;
    return true;
  } catch (err) {
    console.error('Model load failed', err);
    return false;
  }
}

async function detectFace(imageEl) {
  // Multi-pass detector: some framings only resolve at a specific input size.
  // Try highest quality first, fall back progressively.
  const passes = [
    { inputSize: 512, scoreThreshold: 0.45 },
    { inputSize: 416, scoreThreshold: 0.4 },
    { inputSize: 320, scoreThreshold: 0.35 },
  ];
  for (const opts of passes) {
    try {
      const options = new faceapi.TinyFaceDetectorOptions(opts);
      const result = await faceapi.detectSingleFace(imageEl, options).withFaceLandmarks();
      if (result) return result;
    } catch (e) { /* try next pass */ }
  }
  return null;
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function angleDeg(a, b) { return Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Softer deviation → score curve. A near-ideal ratio now scores ~9.5,
// small deviations stay in the 7-8 band, only genuinely off ratios drop
// below 5. Old curve was too punishing for realistic photos.
function scoreFromDeviation(actual, ideal, tolerance) {
  const dev = Math.abs(actual - ideal) / tolerance;
  // dev=0 → 10, dev=1 → 6.5, dev=2 → ~3.5, dev=3 → floor
  const score = 10 - Math.pow(dev, 1.35) * 3.5;
  return clamp(score, 2, 10);
}

function samplePatchVariance(ctx, cx, cy, size, canvas) {
  const x = clamp(Math.round(cx - size / 2), 0, canvas.width - size);
  const y = clamp(Math.round(cy - size / 2), 0, canvas.height - size);
  try {
    const data = ctx.getImageData(x, y, size, size).data;
    let sum = 0, sumSq = 0, n = 0;
    let rSum = 0, gSum = 0, bSum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = (r + g + b) / 3;
      sum += lum; sumSq += lum * lum; n++;
      rSum += r; gSum += g; bSum += b;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    return { variance, r: rSum / n, g: gSum / n, b: bSum / n };
  } catch (e) { return null; }
}

function estimateSkinScore(canvas, points) {
  // Four sample patches: forehead, both cheeks, chin. Score is the mean
  // smoothness (low local variance) with a small penalty for large
  // color drift between patches (tone unevenness).
  const ctx = canvas.getContext('2d');
  const forehead = { x: (points[19].x + points[24].x) / 2,
                     y: points[19].y - (points[8].y - points[27].y) * 0.15 };
  const patches = [forehead, points[2], points[14], points[8]];
  const samples = [];
  patches.forEach((p) => {
    const s = samplePatchVariance(ctx, p.x, p.y, 20, canvas);
    if (s) samples.push(s);
  });
  if (!samples.length) return 6.8;
  const avgVar = samples.reduce((a, s) => a + s.variance, 0) / samples.length;
  const avgR = samples.reduce((a, s) => a + s.r, 0) / samples.length;
  const avgG = samples.reduce((a, s) => a + s.g, 0) / samples.length;
  const avgB = samples.reduce((a, s) => a + s.b, 0) / samples.length;
  const toneDrift = samples.reduce((a, s) =>
    a + Math.hypot(s.r - avgR, s.g - avgG, s.b - avgB), 0) / samples.length;
  const smoothness = 10 - (avgVar / 110);
  const evenness = 10 - (toneDrift / 14);
  const score = smoothness * 0.65 + evenness * 0.35;
  return clamp(score, 5, 9.6);
}

function analyzeLandmarks(landmarks, canvas) {
  const pts = landmarks.positions;

  const jaw = pts.slice(0, 17);
  const noseBridge = pts.slice(27, 31);
  const noseBase = pts.slice(31, 36);
  const rightEye = pts.slice(36, 42);
  const leftEye = pts.slice(42, 48);
  const mouth = pts.slice(48, 60);

  const chin = jaw[8];
  const jawL = jaw[0];
  const jawR = jaw[16];
  const browTop = { x: (pts[19].x + pts[24].x) / 2, y: Math.min(pts[19].y, pts[24].y) };
  const noseTip = pts[30];
  const noseBaseC = { x: (noseBase[0].x + noseBase[4].x) / 2, y: noseBase[2].y };

  const interocular = dist(rightEye[3], leftEye[0]);
  const eyeSpanOuter = dist(rightEye[0], leftEye[3]);
  const faceWidth = dist(jawL, jawR);
  // Midline: use nose-bridge line, not chin midpoint — much more stable
  // when the head is tilted or slightly turned.
  const midlineX = (pts[27].x * 0.6 + pts[30].x * 0.4);

  // ---- Canthal tilt ----
  const rTilt = -angleDeg(rightEye[0], rightEye[3]);
  const lTilt = angleDeg(leftEye[3], leftEye[0]);
  const canthalTilt = (rTilt + lTilt) / 2;
  const canthalScore = scoreFromDeviation(canthalTilt, 5, 7);

  // ---- Symmetry: horizontal + vertical eye-line offset ----
  const pairs = [[0, 16], [1, 15], [3, 13], [36, 45], [31, 35], [48, 54]];
  let symDiffSum = 0;
  pairs.forEach(([li, ri]) => {
    const dl = Math.abs(pts[li].x - midlineX);
    const dr = Math.abs(pts[ri].x - midlineX);
    symDiffSum += Math.abs(dl - dr) / faceWidth;
  });
  const eyeYOffset = Math.abs(
    ((rightEye[0].y + rightEye[3].y) / 2) - ((leftEye[0].y + leftEye[3].y) / 2)
  ) / faceWidth;
  const symAvg = symDiffSum / pairs.length + eyeYOffset * 0.5;
  const symmetryScore = clamp(10 - symAvg * 60, 3, 10);

  // ---- Midface + facial thirds ----
  const upperMid = dist(browTop, noseBaseC);
  const lowerMid = dist(noseBaseC, chin);
  const midfaceRatio = upperMid / lowerMid;
  const midfaceScoreA = scoreFromDeviation(midfaceRatio, 0.85, 0.3);
  // Facial thirds: brow→nose : nose→lip : lip→chin should be ~equal
  const lipC = { x: (pts[51].x + pts[57].x) / 2, y: (pts[51].y + pts[57].y) / 2 };
  const third1 = upperMid;
  const third2 = dist(noseBaseC, lipC);
  const third3 = dist(lipC, chin);
  const thirdsSum = third1 + third2 + third3;
  const thirdsDev = (Math.abs(third1 - thirdsSum / 3) +
                     Math.abs(third2 - thirdsSum / 3) +
                     Math.abs(third3 - thirdsSum / 3)) / thirdsSum;
  const thirdsScore = clamp(10 - thirdsDev * 22, 3, 10);
  const midfaceScore = (midfaceScoreA * 0.55) + (thirdsScore * 0.45);

  // ---- Jawline ----
  const jawWidthRatio = faceWidth / eyeSpanOuter;
  const jawTaper = dist(jaw[4], jaw[12]) / faceWidth;
  const chinProjection = (chin.y - noseBaseC.y) / faceWidth;
  const jawWidthScore = scoreFromDeviation(jawWidthRatio, 1.6, 0.25);
  const jawTaperScore = scoreFromDeviation(jawTaper, 0.85, 0.12);
  const chinScore = scoreFromDeviation(chinProjection, 0.62, 0.16);
  const jawlineScore = clamp(
    jawWidthScore * 0.4 + jawTaperScore * 0.35 + chinScore * 0.25, 2, 10);

  // ---- Nose ----
  const noseWidth = dist(noseBase[0], noseBase[4]);
  const noseRatio = noseWidth / interocular;
  const noseScore = scoreFromDeviation(noseRatio, 1.0, 0.26);

  // ---- Eyes ----
  const eyeWidth = dist(rightEye[0], rightEye[3]);
  const eyeSpacingRatio = interocular / eyeWidth;
  const eyesScore = scoreFromDeviation(eyeSpacingRatio, 1.0, 0.32);

  // ---- Lips ----
  const mouthWidth = dist(pts[48], pts[54]);
  const lipRatio = mouthWidth / interocular;
  const lipsScore = scoreFromDeviation(lipRatio, 1.5, 0.36);

  // ---- Skin ----
  const skinScore = canvas ? estimateSkinScore(canvas, pts) : 6.8;

  const metrics = {
    canthalTilt: { label: 'Canthal Tilt', score: round1(canthalScore), raw: `${canthalTilt.toFixed(1)}°` },
    symmetry: { label: 'Symmetry', score: round1(symmetryScore), raw: `${(100 - symAvg * 600).toFixed(0)}%` },
    midface: { label: 'Midface', score: round1(midfaceScore), raw: midfaceRatio.toFixed(2) },
    jawline: { label: 'Jawline', score: round1(jawlineScore), raw: jawWidthRatio.toFixed(2) },
    nose: { label: 'Nose', score: round1(noseScore), raw: noseRatio.toFixed(2) },
    eyes: { label: 'Eye Spacing', score: round1(eyesScore), raw: eyeSpacingRatio.toFixed(2) },
    lips: { label: 'Lips', score: round1(lipsScore), raw: lipRatio.toFixed(2) },
    skin: { label: 'Skin', score: round1(skinScore), raw: '—' },
  };

  const weights = { canthalTilt: 0.10, symmetry: 0.20, midface: 0.12, jawline: 0.18, nose: 0.10, eyes: 0.10, lips: 0.08, skin: 0.12 };
  let overall = 0;
  Object.keys(weights).forEach((k) => { overall += metrics[k].score * weights[k]; });

  // Harmony bonus: humans read a face by consistency across features.
  // If several metrics agree at a high level, bump the overall a bit.
  const scoreList = Object.values(metrics).map((m) => m.score);
  const highCount = scoreList.filter((s) => s >= 7).length;
  const veryHighCount = scoreList.filter((s) => s >= 8).length;
  overall += highCount * 0.10 + veryHighCount * 0.12;

  overall = round1(clamp(overall, 1, 10));

  // Potential: modest upward adjustment for metrics that shift with
  // grooming/lifestyle (skin, jaw, posture, symmetry via sleep).
  const improvable = (metrics.skin.score + metrics.jawline.score + metrics.symmetry.score) / 3;
  const headroom = clamp((10 - improvable) * 0.4, 0.3, 1.8);
  const potential = round1(clamp(overall + headroom, overall, 10));

  return {
    overall,
    potential,
    metrics,
    landmarkPoints: pts.map((p) => ({ x: p.x, y: p.y })),
    imageSize: { w: canvas ? canvas.width : 0, h: canvas ? canvas.height : 0 },
  };
}

function round1(n) { return Math.round(n * 10) / 10; }

function tierFor(score) {
  if (score >= 8.8) return { tier: 'ELITE', label: 'Elite Proportion' };
  if (score >= 7.8) return { tier: 'RARE',  label: 'Above Reference' };
  if (score >= 6.8) return { tier: 'HIGH',  label: 'Strong Baseline' };
  if (score >= 5.5) return { tier: 'MID',   label: 'Within Norms' };
  return                { tier: 'BASE',  label: 'Early Baseline' };
}