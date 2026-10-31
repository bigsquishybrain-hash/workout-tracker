# Workout Tracker

Offline-first workout log for Android, installed from the browser as a home-screen app (PWA).

- **Today**: pick a muscle group, log sets (reps, weight in lb), check them off. Autosaves.
- **History**: every past session for an exercise, best weight, volume.
- **Exercises**: add, delete (history kept), group.
- **Backup**: export/restore `WorkoutTracker.xlsx` (sheets: Exercises, Log, About).

Plain HTML/CSS/JS, no build step. Hosted on GitHub Pages. Data lives in the phone's browser storage.
`xlsx.full.min.js` is SheetJS 0.18.5 (Apache-2.0), bundled so it works offline.
When changing files, bump `VERSION` in `sw.js` so phones pick up the update.
