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
  // Multi-pass detection: start with a higher input size for better landmark
  // accuracy on typical selfies, then fall back to a larger/looser pass if
  // the first misses (harder lighting, off-angle faces).
  const passes = [
    { inputSize: 416, scoreThreshold: 0.5 },
    { inputSize: 512, scoreThreshold: 0.35 },
    { inputSize: 320, scoreThreshold: 0.3 },
  ];
  for (const p of passes) {
    try {
      const r = await faceapi
        .detectSingleFace(imageEl, new faceapi.TinyFaceDetectorOptions(p))
        .withFaceLandmarks();
      if (r) return r;
    } catch (e) { /* try next pass */ }
  }
  return null;
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
  // Sample multiple patches (both cheeks, forehead, chin) and combine local
  // luminance variance (smoothness) with cross-patch color drift (tone
  // evenness) for a more stable skin-quality proxy. Still a heuristic —
  // not a dermatological assessment.
  const ctx = canvas.getContext('2d');
  // brow midpoint (approx forehead), left cheek, right cheek, chin area
  const brow = { x: (points[19].x + points[24].x) / 2, y: Math.min(points[19].y, points[24].y) };
  const foreheadY = Math.max(4, brow.y - (points[30].y - brow.y) * 0.55);
  const patches = [
    { x: brow.x, y: foreheadY },
    points[2],
    points[14],
    { x: points[8].x, y: points[8].y - 12 },
  ];
  const size = 22;
  let totalVar = 0;
  const meansL = [];
  const meansAB = []; // rough chroma via (R-G, R-B)
  patches.forEach((p) => {
    const x = clamp(Math.round(p.x - size / 2), 0, canvas.width - size);
    const y = clamp(Math.round(p.y - size / 2), 0, canvas.height - size);
    try {
      const data = ctx.getImageData(x, y, size, size).data;
      let sum = 0, sumSq = 0, sR = 0, sG = 0, sB = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const l = (r + g + b) / 3;
        sum += l; sumSq += l * l;
        sR += r; sG += g; sB += b;
        n++;
      }
      const mean = sum / n;
      totalVar += sumSq / n - mean * mean;
      meansL.push(mean);
      meansAB.push([sR / n - sG / n, sR / n - sB / n]);
    } catch (e) { /* ignore sampling errors */ }
  });
  if (!meansL.length) return 6.5;
  const avgVar = totalVar / meansL.length;
  // Smoothness: lower local variance -> higher score.
  const smoothScore = 10 - (avgVar / 95);
  // Evenness: how tightly patch luminance/chroma cluster across the face.
  const meanL = meansL.reduce((a, b) => a + b, 0) / meansL.length;
  const lSpread = Math.sqrt(meansL.reduce((s, v) => s + (v - meanL) ** 2, 0) / meansL.length);
  const meanA = meansAB.reduce((s, v) => s + v[0], 0) / meansAB.length;
  const meanB = meansAB.reduce((s, v) => s + v[1], 0) / meansAB.length;
  const chromaSpread = Math.sqrt(
    meansAB.reduce((s, v) => s + (v[0] - meanA) ** 2 + (v[1] - meanB) ** 2, 0) / meansAB.length
  );
  const evenScore = 10 - (lSpread / 4) - (chromaSpread / 3);
  const combined = smoothScore * 0.65 + evenScore * 0.35;
  return clamp(combined, 3.5, 9.4);
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
  // Anchor the midline to the nose-bridge/philtrum column (pts 27, 30, 33)
  // instead of averaging brow and chin — this is far more stable against
  // a tilted chin or asymmetric jaw and gives a more accurate symmetry read.
  const midlineX = (pts[27].x + pts[30].x + pts[33].x) / 3;

  // ---- Canthal tilt (avg of both eyes, deg; positive = upturned) ----
  const rTilt = -angleDeg(rightEye[0], rightEye[3]); // outer(0) to inner(3)
  const lTilt = angleDeg(leftEye[3], leftEye[0]);     // inner(3) to outer(0) mirrored
  const canthalTilt = (rTilt + lTilt) / 2;
  const canthalScore = scoreFromDeviation(canthalTilt, 4, 6);

  // ---- Symmetry: compare mirrored landmark pairs on BOTH axes ----
  // For each pair, measure the residual after reflecting one point across
  // the midline — captures both horizontal asymmetry (offset from midline)
  // and vertical asymmetry (one side sitting higher than the other).
  const pairs = [
    [0, 16], [1, 15], [2, 14], [3, 13], [4, 12],   // jaw contour
    [17, 26], [19, 24],                             // brows
    [36, 45], [39, 42],                             // eye corners
    [31, 35], [32, 34],                             // nostrils
    [48, 54], [50, 52], [59, 55],                   // mouth corners + arc
  ];
  let symDiffSum = 0;
  pairs.forEach(([li, ri]) => {
    const mirroredX = 2 * midlineX - pts[ri].x;
    const dx = (pts[li].x - mirroredX) / faceWidth;
    const dy = (pts[li].y - pts[ri].y) / faceWidth;
    symDiffSum += Math.hypot(dx, dy);
  });
  const symAvg = symDiffSum / pairs.length;
  const symmetryScore = clamp(10 - symAvg * 55, 1, 10);

  // ---- Facial thirds: brow->nose base vs nose base->chin (classical 1:1) ----
  const upperMid = dist(browTop, noseBaseC);
  const lowerMid = dist(noseBaseC, chin);
  const midfaceRatio = upperMid / lowerMid;
  // Ideal middle:lower third ≈ 1.0. Blend with the classical 0.82 midface
  // proportion for stability across face shapes.
  const thirdsScore = scoreFromDeviation(midfaceRatio, 1.0, 0.22);
  const classicMid = scoreFromDeviation(midfaceRatio, 0.82, 0.28);
  const midfaceScore = clamp((thirdsScore * 0.6 + classicMid * 0.4), 1, 10);

  // ---- Jawline: width + taper (gonial approx) ----
  const jawWidthRatio = faceWidth / eyeSpanOuter;
  const jawTaper = dist(jaw[4], jaw[12]) / faceWidth; // upper jaw width vs full width
  const jawWidthScore = scoreFromDeviation(jawWidthRatio, 1.62, 0.22);
  const jawTaperScore = scoreFromDeviation(jawTaper, 0.86, 0.1);
  // Chin projection: chin should sit meaningfully below the mouth relative
  // to nose-mouth distance (weak/receding chins score lower).
  const chinProj = dist(pts[57], chin) / Math.max(1, dist(pts[33], pts[51]));
  const chinScore = scoreFromDeviation(chinProj, 1.15, 0.35);
  const jawlineScore = clamp((jawWidthScore + jawTaperScore + chinScore) / 3, 1, 10);

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