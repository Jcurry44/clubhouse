# Vendored apps

Written by `design/scripts/vendor-apps.mjs` (re-run it to re-vendor; `--check` verifies). The originals are never edited.
Copies carry the source working tree **as it is on disk** (uncommitted edits included — that is Joe's newest version).

## Fairway Ledger → `apps/fairway-ledger/`

- Source: `New project/Golf Stats Tracker/`
- Source commit: `8c415174fbe35f346b60dfbde70a0262f62d2a0d` (2026-07-30 10:25:59 -0400) · working tree clean for the vendored files
- 16 files · 2.4 MB · vendored 2026-09-28
- Excluded: data/golf-lab/ (1.8 GB), data/course-source/, data/course-maps/*.json|*.geojson|*.md (not loaded at runtime), tests/, tools/, docs/, logs/, supabase/, sw.js, manifest.json, *.md, .git, .claude
- Added: `clubhouse-bridge.css`, `clubhouse-bridge.js`
- Patches (each marked `CLUBHOUSE` in the file; nothing else differs from the source):
  - `index.html` — service-worker registration removed — Clubhouse's sw.js owns the whole scope
  - `index.html` — manifest link removed so "Add to Home Screen" from this page cannot create a second app scope
  - `index.html` — bridge stylesheet for the return control
  - `index.html` — "‹ Clubhouse" return control, fixed bottom-left (+ the #clubhouse-import deep-link helper script)
  - `app.js` — `let screenWakeLock` became `var`: renderGames() at boot calls syncWakeLock() before the `let` line ran, an unhandled "Cannot access screenWakeLock before initialization" on every load (the original has it too)

| File | sha256 (12) |
|---|---|
| `index.html` (patched) | `8f92f2df2149` |
| `app.js` (patched) | `af2b6109d6cb` |

## Barrel Proof → `apps/barrel-proof/`

- Source: `New project/Barrel Proof/`
- Source commit: `928eaf42223118524d2f84f6fd62e1e84494a122` (2026-06-11 18:17:56 -0400) · **9 vendored file(s) differ from that commit in the working tree** (index.html, src/data/bottles.js, src/logic/night.js, src/storage/store.js, src/ui/render.js, styles.css, src/logic/table-game.js, src/ui/table-game.css, …)
- 36 files · 15.6 MB · vendored 2026-09-28
- Excluded: src/data/imported-catalog.json (68 MB, never fetched at runtime), data/ (159 MB), tests/, tools/, docs/, supabase/, service-worker.js, manifest.json, *.bat, *.ps1, *.log, *.md, .git, .claude
- Added: `clubhouse-bridge.css`, `clubhouse-bridge.js`
- Patches (each marked `CLUBHOUSE` in the file; nothing else differs from the source):
  - `src/main.js` — registerServiceWorker() returns immediately — Clubhouse's sw.js owns the scope
  - `src/main.js` — bootHardReset clears only barrel-proof* caches and never unregisters the Clubhouse worker
  - `index.html` — manifest link removed (one installed app: Clubhouse)
  - `index.html` — bridge stylesheet for the return control
  - `index.html` — "‹ Clubhouse" return control, fixed bottom-left (+ the #clubhouse-import deep-link helper script)

| File | sha256 (12) |
|---|---|
| `index.html` (patched) | `bb2d3d39eb63` |
| `src/main.js` (patched) | `141c264dee22` |

Storage: the copies keep their own localStorage keys (`fairwayLedger.*`, `barrel-proof-state-v1`) and their own
Export / Import / snapshot flows. They run inside the Clubhouse scope, so Home reads the same keys directly (SPEC §3.3).
