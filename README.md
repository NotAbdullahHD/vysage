# Vysage — Facial Analysis PWA (v2)

Installable, camera-based facial geometry scanner. Works on phone (Add to Home Screen) and desktop browsers. 100% client-side — no backend, no account, no data leaves the device.

## What's new in this version
- **Expanded intake**: name, gender, date of birth, height, weight, objectives, "how far you're open to going" (neutral/soft/hard/experimental), and an aspirational **archetype** picker — every question has a Skip button.
- Note: the archetype step intentionally uses generic look categories, not real celebrities. Letting users pick a specific real person as a "target face" to be scored against is a well-documented trigger for body-image issues, so that piece isn't built here — swap in your own copy for the archetype cards if you want different categories.
- **Front + side capture** flow after onboarding (and before every new scan), each with camera or upload.
- **Analyzing screen**: animated progress bar + rotating tips/facts while the model runs.
- **Daily scan limit**: 2 scans/day by default (`DAILY_LIMIT` in `app.js`), tracked in localStorage and reset at midnight local time.
- **Neon reveal screen**: cyan/blue glow theme, count-up score animation, staggered metric-card entrance, landmark-dot overlay on your photo, and a **Download image** button (via html2canvas) sized for a 9:16 screen recording/share.
- **Dashboard is now the home screen** — lands there after onboarding/scans, shows your best score, geometry map, and "how to improve" suggestions, with a "New scan" button that respects the daily limit.

## Files
- `index.html` — onboarding, capture flow, dashboard/progress/profile shell
- `style.css` — base theme (charcoal/gold/teal) + neon reveal theme
- `app.js` — all app logic and state
- `faceAnalysis.js` — face-api.js model loading + landmark-based scoring
- `manifest.json` / `sw.js` — installability + offline shell
- `icons/` — app icons

## Must be served over HTTPS (or localhost)
Camera access and service workers don't work on `file://`. Test locally:
```bash
cd vysage
python3 -m http.server 8080
# open http://localhost:8080
```
To use on your phone, deploy anywhere with HTTPS — **Netlify Drop** (app.netlify.com/drop, drag the folder in) is the fastest zero-setup option. Then:
- **iPhone**: Safari → Share → Add to Home Screen
- **Android**: Chrome → ⋮ → Add to Home screen

## Notes on the scoring & content choices
- Scoring is a proportion-ratio heuristic from face-landmark geometry — self-tracking/entertainment, not a medical or scientific assessment. Said once in onboarding, not repeated as a lecture elsewhere.
- The side photo is captured and stored for your own before/after record but isn't currently scored — the landmark model isn't reliable at that angle. Front photo drives the score.
- Regardless of the "how far are you open to going" answer, `PROTOCOL_LIBRARY` in `app.js` only ever surfaces low-risk habit suggestions (sleep, hydration, posture, skincare, grooming) — no medical, surgical, or drug content, by design. If you extend this, keep that boundary.
- Height/weight are stored on the profile only; nothing in the app computes BMI or any health metric from them.

## Customizing
- Reference ratios/weights: `analyzeLandmarks()` in `faceAnalysis.js`
- Protocol/advice copy: `PROTOCOL_LIBRARY` in `app.js`
- Analyzing-screen tips: `ANALYZE_TIPS` in `app.js`
- Daily limit: `DAILY_LIMIT` constant in `app.js`
- Archetype cards: the `#archetype-grid` block in `index.html`
- Colors/fonts: CSS variables at the top of `style.css`; neon reveal variables (`--neon-*`) further down
