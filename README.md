# Ironman Coach

Adaptive sub-12 Ironman training app that runs entirely in your browser and reads your data from [intervals.icu](https://intervals.icu).

**Live:** https://marcin-z-k.github.io/ironman-coach/

## What it does

- **Today** — the session(s) you should do today with steps, targets in watts / pace, and a week strip. Readiness (fitness, fatigue, form, HRV, resting HR, sleep) from intervals.icu wellness.
- **Plan** — periodised plan from now to race day: Base → Build → Peak → Taper → Race week, every 4th week a recovery week. Volume ramps from your current weekly hours by ~45%.
- **Adaptation** — on every sync the plan is re-shaped from your data:
  - deep fatigue (form < −30 or several warning signs) → week −20%, intensity removed
  - carrying fatigue / ramp rate > 7 → −10%
  - low compliance (< 70% of planned load over 14 days) → −10% so the plan stays realistic
  - two solid weeks, fresh → +5%
  - low HRV / high resting HR / short sleep → advice to swap today's key session
  - new FTP / threshold pace / CSS in your intervals.icu sport settings → zones and targets update automatically
- **Activities** — every activity matched to its planned session, with a coach summary: verdict (on target / too hard / under-delivered), what happened and what to change. Uses Claude (Anthropic API key, optional) or built-in rules.
- **Progress** — projected race time from current thresholds, progress toward sub-12 targets (CSS 1:48, run threshold 5:13/km, FTP ≈230 W), fitness/fatigue chart, planned vs done hours.

## Setup

1. Open the app → **Settings**.
2. Enter your intervals.icu **Athlete ID** (starts with `i`) and **API key** (intervals.icu → Settings → Developer Settings).
3. Optional: an Anthropic API key for AI summaries.
4. Save & sync. On iPhone: Share → *Add to Home Screen* for an app-like experience.

Keys are stored only in your browser's localStorage and sent only to intervals.icu / Anthropic. Nothing is stored on a server.

## Development

Plain ES modules, no build step. `python3 -m http.server` in this folder and open http://localhost:8000. Settings → Advanced → Demo mode for synthetic data.
