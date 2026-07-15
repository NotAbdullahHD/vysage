# Vysage — Facial Analysis PWA

A installable, camera-based facial geometry scanner and scoring app. Works on phone (Add to Home Screen) and desktop browsers. 100% client-side — no backend, no account, no data leaves the device.

## What's inside
- `index.html` — app shell (onboarding + dashboard)
- `style.css` — theme ("survey instrument / blueprint" aesthetic: charcoal background, gold measurement lines, teal scan accents, Fraunces + IBM Plex type)
- `app.js` — onboarding flow, camera capture, navigation, dashboard/progress rendering, localStorage persistence
- `faceAnalysis.js` — loads face-api.js models and turns 68-point facial landmarks into proportion-based scores
- `manifest.json` + `sw.js` — makes it installable / usable offline
- `icons/` — app icons

## Important: this must be served over HTTPS (or localhost)
Camera access (`getUserMedia`) and service workers are blocked by browsers on plain `file://` pages. You need to serve the folder — any of these work:

**Quickest way to test locally:**
```bash
cd vysage
python3 -m http.server 8080
# then open http://localhost:8080 on this computer
```

**To actually use it on your phone** (needed for camera + "Add to Home Screen"), deploy it somewhere with HTTPS. Easiest free options:
- **Netlify Drop** — go to app.netlify.com/drop, drag the whole `vysage` folder in, get a live HTTPS URL instantly.
- **Vercel** or **GitHub Pages** — push the folder to a repo and connect it (also free).

Once it's live at an HTTPS URL:
- **iPhone**: open the link in Safari → Share icon → "Add to Home Screen."
- **Android**: open the link in Chrome → menu (⋮) → "Add to Home screen" / "Install app."

## How the scoring works (read this before treating it as gospel)
On capture, the app runs a face-landmark model in the browser, then computes proportion ratios (canthal tilt, facial thirds, jaw width/taper, interocular spacing, etc.) and compares them against reference ratios often cited in facial-proportion literature. Skin score is a rough pixel-smoothness sample, not a dermatological read. It's a self-tracking/entertainment tool — the in-app note about that is intentional, not boilerplate.

## Customizing
- Swap reference ratios/weights in `faceAnalysis.js` (`analyzeLandmarks`) if you want to tune scoring.
- Protocol/advice copy lives in `PROTOCOL_LIBRARY` in `app.js`.
- Colors/fonts are CSS variables at the top of `style.css`.
