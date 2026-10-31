# Ironman Coach

Adaptive sub-12 Ironman training app that runs entirely in your browser and reads your data from [intervals.icu](https://intervals.icu).

**Live:** https://marcin-z-k.github.io/ironman-coach/

## What it does

- **Fixed week, adaptive content.** Your days are fixed (default: Mon rest · Tue swim · Wed interval run · Thu swim · Fri indoor bike + brick run · Sat long run · Sun long outdoor ride — editable in Settings). Durations, intensity and focus change with the phase (base → build → peak → taper → race week) and your data.
- **Goal-focused sessions.** Swim: technique + a continuous swim that grows from 600 m to 3.8 km (shoulder-friendly). Run: easy pace at Z2 HR (priority), intervals, long run to 3 h with 9:1 run/walk. Bike: sweet-spot / threshold / over-unders indoors (indoor FTP) and strong-steady blocks inside the long outdoor ride (by HR when there is no power meter).
- **Day swaps.** An activity on another day completes the planned session of that sport in the same week. Done early → the two days swap; done late → just moves. Manual "Swap day" on any session.
- **Catch-up & focus.** 50% of missed time is spread over the remaining sessions of that sport (max +20% each, rest next week). A discipline whose sessions keep under-delivering gets up to +12% time.
- **Indoor vs outdoor bike.** Indoor FTP drives trainer workouts and is estimated from indoor rides with real power only; estimated (Strava) outdoor watts are ignored. Values you type in Settings are kept for 4 weeks.
- **Home:** Stamina-style rings (hours done / planned per discipline this week), health widgets (readiness, sleep, fitness, fatigue, form, VO2max, HRV, resting HR) with trend pages.
- **Progress:** interactive race simulator (FTP, CSS, run threshold, continuous swim/run distance, wetsuit) using a model with fade — swim stops beyond your continuous distance, run/walk beyond your continuous run, bike from your real long-ride speed; PMC chart projected to race day; threshold estimates; easy pace at Z2 HR; weekly hours. Every chart shows exact values on hover/tap.
- **Workout export:** .FIT (Garmin/Wahoo), .ZWO (Zwift) and "Send to device" (writes the workout to your intervals.icu calendar, which forwards it to connected devices).
- **Login:** works with your browser's password manager, backed up in IndexedDB, auto sign-in where supported.

## Setup

1. Open the app and sign in with your intervals.icu athlete ID (starts with `i`) and API key (intervals.icu → Settings → Developer Settings).
2. Check Settings: indoor FTP, power meter outdoors yes/no, longest continuous swim/run, weekly schedule.
3. On iPhone: Share → *Add to Home Screen*.

Keys stay on your device and are only sent to intervals.icu (and Anthropic if you add an AI key). The Garmin FIT SDK is loaded from a CDN at runtime (its license doesn't allow bundling it here).

## Development

Plain ES modules, no build step: `python3 -m http.server` and open http://localhost:8000. Settings → Advanced → Demo mode for synthetic data.
