/* ============================================================
   Vysage — Face geometry analysis
   Uses face-api.js (tiny face detector + 68pt landmark model)
   entirely client-side. All scoring below is a proportion-based
   heuristic for self-tracking/entertainment — not a scientific
   or medical measurement.
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
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 });
  const result = await faceapi.detectSingleFace(imageEl, options).withFaceLandmarks();
  return result || null;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleDeg(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Map a raw ratio's closeness to an "ideal" ratio into a 0-10 score
function scoreFromDeviation(actual, ideal, tolerance) {
  const dev = Math.abs(actual - ideal) / tolerance;
  const score = 10 - dev * 6;
  return clamp(score, 1, 10);
}

function estimateSkinScore(canvas, points) {
  // Sample a patch on each cheek, measure local pixel variance as a
  // rough smoothness proxy. Not a dermatological assessment.
  const ctx = canvas.getContext('2d');
  const patches = [
    points[1], points[15] // near cheeks
  ];
  let totalVar = 0;
  let samples = 0;
  patches.forEach((p) => {
    const size = 18;
    const x = clamp(Math.round(p.x - size / 2), 0, canvas.width - size);
    const y = clamp(Math.round(p.y - size / 2), 0, canvas.height - size);
    try {
      const data = ctx.getImageData(x, y, size, size).data;
      let sum = 0, sumSq = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const g = (data[i] + data[i + 1] + data[i + 2]) / 3;
        sum += g; sumSq += g * g; n++;
      }
      const mean = sum / n;
      const variance = sumSq / n - mean * mean;
      totalVar += variance;
      samples++;
    } catch (e) { /* ignore sampling errors */ }
  });
  if (!samples) return 6.5;
  const avgVar = totalVar / samples;
  // lower local variance (smoother patch) -> higher score. Empirically
  // tuned range; clamps to keep results in a believable band.
  const score = 10 - (avgVar / 90);
  return clamp(score, 4, 9.2);
}

function analyzeLandmarks(landmarks, canvas) {
  const pts = landmarks.positions;

  // Key groups (dlib 68-pt scheme)
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

  const interocular = dist(rightEye[3], leftEye[0]); // inner corners
  const eyeSpanOuter = dist(rightEye[0], leftEye[3]); // outer corners
  const faceWidth = dist(jawL, jawR);
  const midlineX = (pts[27].x + chin.x) / 2;

  // ---- Canthal tilt (avg of both eyes, deg; positive = upturned) ----
  const rTilt = -angleDeg(rightEye[0], rightEye[3]); // outer(0) to inner(3)
  const lTilt = angleDeg(leftEye[3], leftEye[0]);     // inner(3) to outer(0) mirrored
  const canthalTilt = (rTilt + lTilt) / 2;
  const canthalScore = scoreFromDeviation(canthalTilt, 4, 6);

  // ---- Symmetry: compare left/right distances from facial midline ----
  const pairs = [[0, 16], [1, 15], [3, 13], [36, 45], [31, 35], [48, 54]];
  let symDiffSum = 0;
  pairs.forEach(([li, ri]) => {
    const dl = Math.abs(pts[li].x - midlineX);
    const dr = Math.abs(pts[ri].x - midlineX);
    symDiffSum += Math.abs(dl - dr) / faceWidth;
  });
  const symAvg = symDiffSum / pairs.length;
  const symmetryScore = clamp(10 - symAvg * 90, 1, 10);

  // ---- Midface ratio: (brow->nose base) vs (nose base->chin) ----
  const upperMid = dist(browTop, noseBaseC);
  const lowerMid = dist(noseBaseC, chin);
  const midfaceRatio = upperMid / lowerMid;
  const midfaceScore = scoreFromDeviation(midfaceRatio, 0.82, 0.28);

  // ---- Jawline: width + taper (gonial approx) ----
  const jawWidthRatio = faceWidth / eyeSpanOuter;
  const jawTaper = dist(jaw[4], jaw[12]) / faceWidth; // upper jaw width vs full width
  const jawWidthScore = scoreFromDeviation(jawWidthRatio, 1.62, 0.22);
  const jawTaperScore = scoreFromDeviation(jawTaper, 0.86, 0.1);
  const jawlineScore = clamp((jawWidthScore + jawTaperScore) / 2, 1, 10);

  // ---- Nose: width relative to interocular distance ----
  const noseWidth = dist(noseBase[0], noseBase[4]);
  const noseRatio = noseWidth / interocular;
  const noseScore = scoreFromDeviation(noseRatio, 1.0, 0.22);

  // ---- Eyes: interocular spacing relative to eye width ----
  const eyeWidth = dist(rightEye[0], rightEye[3]);
  const eyeSpacingRatio = interocular / eyeWidth;
  const eyesScore = scoreFromDeviation(eyeSpacingRatio, 1.0, 0.28);

  // ---- Lips: mouth width relative to interocular distance ----
  const mouthWidth = dist(pts[48], pts[54]);
  const lipRatio = mouthWidth / interocular;
  const lipsScore = scoreFromDeviation(lipRatio, 1.5, 0.32);

  // ---- Skin proxy ----
  const skinScore = canvas ? estimateSkinScore(canvas, pts) : 6.5;

  const metrics = {
    canthalTilt: { label: 'Canthal Tilt', score: round1(canthalScore), raw: `${canthalTilt.toFixed(1)}°` },
    symmetry: { label: 'Symmetry', score: round1(symmetryScore), raw: `${(100 - symAvg * 900).toFixed(0)}%` },
    midface: { label: 'Midface', score: round1(midfaceScore), raw: midfaceRatio.toFixed(2) },
    jawline: { label: 'Jawline', score: round1(jawlineScore), raw: jawWidthRatio.toFixed(2) },
    nose: { label: 'Nose', score: round1(noseScore), raw: noseRatio.toFixed(2) },
    eyes: { label: 'Eye Spacing', score: round1(eyesScore), raw: eyeSpacingRatio.toFixed(2) },
    lips: { label: 'Lips', score: round1(lipsScore), raw: lipRatio.toFixed(2) },
    skin: { label: 'Skin', score: round1(skinScore), raw: '—' },
  };

  const weights = { canthalTilt: 0.10, symmetry: 0.22, midface: 0.12, jawline: 0.20, nose: 0.10, eyes: 0.1, lips: 0.06, skin: 0.10 };
  let overall = 0;
  Object.keys(weights).forEach((k) => { overall += metrics[k].score * weights[k]; });
  overall = round1(clamp(overall, 1, 10));

  // Potential: modest upward adjustment reflecting metrics that commonly
  // shift with grooming/lifestyle changes (skin, jaw definition, posture).
  const improvable = (metrics.skin.score + metrics.jawline.score) / 2;
  const headroom = clamp((10 - improvable) * 0.35, 0.2, 1.6);
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
  if (score >= 8.5) return { tier: 'RARE', label: 'Elite Proportion' };
  if (score >= 7.3) return { tier: 'HIGH', label: 'Above Reference' };
  if (score >= 6) return { tier: 'MID-HIGH', label: 'Solid Baseline' };
  if (score >= 4.5) return { tier: 'MID', label: 'Within Norms' };
  return { tier: 'BASE', label: 'Early Baseline' };
}
