# Vysage — Facial Analysis PWA (v3)

Installable, camera-based facial geometry scanner. Works on phone (Add to Home Screen) and desktop browsers. Client-side scanning and scoring — no account needed to use the free tier; Pro billing runs through a small Stripe backend (see below).

## What's new in this version
- **Animated GIF export.** "Save GIF" sits next to "Save PNG" on the reveal screen. It replays the exact same entrance animation (score count-up, staggered card fade-ins, photo pop) frame-by-frame using the same easing curves as the live CSS, then encodes it client-side with gif.js. Takes a few seconds — the button shows render progress.
- **Dedicated Pro tab.** Bottom nav is now Dashboard / Progress / **Pro** / Profile. The Plan card also still lives at the top of Profile — both open the same Plans screen.
- **Upsell + fun-fact popups:**
  - Hitting the daily scan limit now opens a modal explaining why Pro removes it, instead of just a dead disabled button.
  - Every 3rd completed scan (Free tier only), a rotating Pro-benefit reminder appears after tapping Continue.
  - A random "did you know" fact about facial proportions/photography can pop up when opening the Dashboard tab (throttled to roughly once per 6 hours, ~45% chance when eligible, so it doesn't nag). Edit `FUN_FACTS` / `UPSELL_MESSAGES` in `app.js` to change the copy.
  - Push notifications were mentioned as a "maybe later" — not built here. That needs Web Push (service worker `push` event + VAPID keys) and, since this app has no user accounts, somewhere server-side to store subscriptions. Flagging it as a real future task, not started.
- **Real Stripe billing wired up** — Checkout, webhook, and Customer Portal (full setup steps below). Falls back to a local simulated upgrade automatically if the `/api` routes aren't reachable yet — e.g. testing locally before the backend is deployed — so the UI still demos either way.
- **Fixed: uploads were silently forcing the camera on mobile.** The file inputs had a `capture="user"` attribute, which many mobile browsers (notably Android Chrome) treat as "always launch the camera," skipping the gallery entirely. Removed — Upload now opens the real photo picker (camera or gallery) on phone, and the normal file browser on desktop.

## Earlier additions (still in place)
- **Expanded intake**: name, gender, date of birth, height, weight, objectives, "how far you're open to going" (neutral/soft/hard/experimental), and an aspirational **archetype** picker — every question has a Skip button.
  - Note: the archetype step intentionally uses generic look categories, not real celebrities. Letting users pick a specific real person as a "target face" to be scored against is a well-documented trigger for body-image issues, so that piece isn't built here — swap in your own copy in `#archetype-grid` if you want different categories.
- **Front + side capture** flow after onboarding and before every new scan, each with camera or upload.
- **Analyzing screen**: animated progress bar + rotating tips while the model runs.
- **Daily scan limit**: 2 scans/day for Free (`DAILY_LIMIT` in `app.js`), unlimited for Pro, resets at local midnight.
- **Neon reveal screen**: cyan/blue glow theme, count-up score animation, staggered metric-card entrance, landmark-dot overlay on your photo.
- **Dashboard is the home screen** — lands there after onboarding/scans, shows your best score, geometry map, and "how to improve" suggestions.
- **Vysage Pro feature gating**: daily limit bypass, watermark-free exports, full scan history (Free caps the visible list at 5 with an upsell nudge — the trend chart itself always shows full history regardless of tier), driven by the data-driven `PLAN_FEATURES` array in `app.js`.

## Setting up real Stripe billing on Vercel

The app now has five serverless functions in `/api` and a `package.json` (Vercel needs that to install the `stripe` package for those functions — this project has no other build step, it's still plain static files otherwise).

**1. Create the product & prices in Stripe**
- Stripe Dashboard → Product catalog → add a product ("Vysage Pro") with two **recurring prices**: one monthly, one yearly.
- Copy each price's ID (`price_...`, not the product ID).

**2. Set environment variables in Vercel**
Project → Settings → Environment Variables (set these for both Production and Preview if you test on preview deployments):

| Variable | Where to get it |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys (use the **test** secret key first, switch to live later) |
| `STRIPE_PRICE_ID_MONTHLY` | the monthly price ID from step 1 |
| `STRIPE_PRICE_ID_YEARLY` | the yearly price ID from step 1 |
| `STRIPE_WEBHOOK_SECRET` | from step 3 below |

Never put any of these in client-side code or commit them to the repo — they only belong in Vercel's environment variable settings, where `process.env.*` picks them up server-side inside `/api`.

**3. Add the webhook endpoint**
- Stripe Dashboard → Developers → Webhooks → Add endpoint
- URL: `https://vysage.vercel.app/api/stripe-webhook`
- Events to send: at minimum `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- Copy the **signing secret** it gives you into `STRIPE_WEBHOOK_SECRET` in Vercel, then redeploy so the new env var is picked up.

**4. Redeploy**
Once the env vars are set, redeploy (or push a commit) so the functions can see them. Test with [Stripe's test card numbers](https://docs.stripe.com/testing) in test mode before flipping to live keys.

**How the pieces fit together:**
- `api/create-checkout-session.js` — client calls this to get a Stripe Checkout URL, then redirects the browser there.
- `api/verify-session.js` — called right after Stripe redirects back, for immediate UI feedback.
- `api/stripe-webhook.js` — the *real* source of truth per Stripe's own guidance (a user can close the tab before the redirect-based check ever runs, but the webhook still fires reliably). It currently just logs events — see the `TODO` comment inside it for where a database write would go if you add real user accounts later.
- `api/check-subscription.js` — called on every app load for anyone already marked Pro, to catch cancellations or payment failures made from Stripe's own portal.
- `api/create-portal-session.js` — powers "Manage subscription" in the Plans screen, sending the user to Stripe's hosted portal to update payment method or cancel.

**Important limitation to know about:** this app has no user accounts or database — "being Pro" is tracked by a Stripe customer ID sitting in the browser's `localStorage`. That's a reasonable MVP for a single-device app, but Pro status won't follow someone across devices or browsers. A full "add real accounts" pass (email + something like Supabase/Firebase, syncing subscription status server-side) is the natural next step if this grows — the webhook handler is already structured so that's a small addition later, not a rewrite.

## Files
- `index.html` — onboarding, capture flow, dashboard/progress/plans/profile shell
- `style.css` — base theme (charcoal/gold/teal), neon reveal theme, modal + plans styling
- `app.js` — all client-side app logic and state
- `faceAnalysis.js` — face-api.js model loading + landmark-based scoring
- `manifest.json` / `sw.js` — installability + offline shell
- `icons/` — app icons
- `api/` — Stripe serverless functions (see above)
- `package.json` — declares the `stripe` dependency for Vercel to install

## Must be served over HTTPS (or localhost)
Camera access and service workers don't work on `file://`. Test locally:
```bash
cd vysage
python3 -m http.server 8080
# open http://localhost:8080
```
Note: the `/api` routes only run on Vercel (or `vercel dev` locally) — a plain static server like the one above will 404 on them, which is fine, since the client automatically falls back to a simulated local upgrade in that case.

## Notes on the scoring & content choices
- Scoring is a proportion-ratio heuristic from face-landmark geometry — self-tracking/entertainment, not a medical or scientific assessment. Said once in onboarding, not repeated as a lecture elsewhere.
- The side photo is captured and stored for your own before/after record but isn't currently scored — the landmark model isn't reliable at that angle. Front photo drives the score.
- Regardless of the "how far are you open to going" answer, `PROTOCOL_LIBRARY` in `app.js` only ever surfaces low-risk habit suggestions (sleep, hydration, posture, skincare, grooming) — no medical, surgical, or drug content, by design. If you extend this, keep that boundary.
- Height/weight are stored on the profile only; nothing in the app computes BMI or any health metric from them.

## Customizing
- Reference ratios/weights: `analyzeLandmarks()` in `faceAnalysis.js`
- Protocol/advice copy: `PROTOCOL_LIBRARY` in `app.js`
- Analyzing-screen tips: `ANALYZE_TIPS` in `app.js`; fun facts: `FUN_FACTS`; upsell copy: `UPSELL_MESSAGES`
- Plan perks table: `PLAN_FEATURES` in `app.js`; pricing display: `PLAN_PRICING`
- Daily limit: `DAILY_LIMIT` constant in `app.js`
- Archetype cards: the `#archetype-grid` block in `index.html`
- Colors/fonts: CSS variables at the top of `style.css`; neon reveal variables (`--neon-*`) further down
