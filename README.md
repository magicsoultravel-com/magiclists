# magiclists
magiclists

## Cache, deploys and the boot overlay

The app is a static ES-module site on GitHub Pages, which cannot set response
headers (`Cache-Control: max-age=600` on every file). Deep module imports carry
no `?v=` of their own, so a deploy can leave a browser holding a **stale cached
module** next to a fresh one. When the fresh module imports a name the stale one
does not export, the browser fails to link the whole graph, `js/app.js` never
evaluates, and `#app-boot` stays on screen forever.

Guards now in place:

| Command | What it does |
| --- | --- |
| `npm run assets:stamp` | Rewrites `index.html` / `popout.html`: content hash on every `<script type="module" src>` and `<link rel="stylesheet">`, plus an inline `<script type="importmap">` that maps every `js/**.js` to `?v=<content hash>`. Run after touching anything in `js/` or `css/`. |
| `npm run check:assets` | Fails when the stamped HTML no longer matches the current file contents. |
| `npm run check:modules` | Links the real module graph with V8 (`vm.SourceTextModule`, nothing executed) and fails on any import whose target does not export that name. |
| `npm test` | Full `node --test` suite (`test/assetVersions.test.js`, `test/moduleGraph.test.js`, `test/bootWatchdog.test.js` cover the guards above). |
| `npm run verify` | All of the above in CI order. |

`scripts/git-hooks/pre-commit.mjs` restamps and re-stages the HTML and runs the
module-graph check, so a commit cannot ship stale hashes or a broken import.
GitHub Pages uses the same file names for every deploy, so never remove the
`?v=` attributes by hand.

Runtime fail-safe: `index.html` carries an inline classic-script watchdog. If the
module graph fails, a local asset 404s, a dynamic import fails, or boot simply
never finishes (15s, paused while the storage-quota prompt is open) it replaces
"Loading workspace…" with an explanation and a Reload button, and sets
`window.__magicnotesBootFailed`. `js/bootProgress.js` sets
`window.__magicnotesBooted` so a slow but healthy boot is never reported.

If a user reports a stuck dark screen, the data is intact: a hard reload
(`Ctrl`/`Cmd` + `Shift` + `R`) recovers, and storage-full profiles now see the
"Storage almost full" prompt above the boot overlay instead of being stuck
behind it.
