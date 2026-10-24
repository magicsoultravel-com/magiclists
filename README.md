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
| `npm run check:modules` | Links the real module graph with V8 (`vm.SourceTextModule`, nothing executed) and fails on any import whose target does not export that name. It also resolves every literal `import('./x.js')` itself, because the engine resolves dynamic specifiers lazily and `link()` never sees them. |
| `npm test` | Full `node --test` suite (`test/assetVersions.test.js`, `test/moduleGraph.test.js`, `test/bootWatchdog.test.js` cover the guards above). |
| `npm run verify` | All of the above in CI order. |
| `npm run hooks:install` | Installs `.git/hooks/pre-commit` (also runs on `npm install`). Needed once per clone. |

Run `npm install` once per clone: `test/freeIdentifierScan.test.js` parses
`js/**.js` with `acorn`, the repo's only devDependency.

`scripts/git-hooks/pre-commit.mjs` restamps and re-stages the HTML and runs the
module-graph check, so a commit cannot ship stale hashes or a broken import.
GitHub Pages uses the same file names for every deploy, so never remove the
`?v=` attributes by hand.

Git silently skips a hook file that is not executable, so the guard is only real
once installed: `npm run hooks:install` drops in a small `sh` shim
(`scripts/git-hooks/install.mjs`) and marks it `0755`. The shim defers to the
Node hook, so it works on Linux/macOS and Git for Windows alike; a hook that was
already there is backed up rather than overwritten silently, and
`MAGICLISTS_SKIP_HOOKS=1` opts out.

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

## Detached sidebar: the bounds feedback loop

`#side-panel` sits in the middle of a broadcast chain: `js/toolsManager.js`
observes its `class` attribute and dispatches `tools:desktop_bounds_changed`,
and `js/sidebarDetach.js` answers that event by re-clamping the floating panel —
which writes classes and inline geometry back onto the same element.
MutationObserver callbacks run in the microtask queue and never throw, so a
self-feeding cycle starves the main thread **silently**: the tab freezes with a
clean console, and once `detached: true` is in `localStorage` it freezes during
boot too, because the re-clamp then runs synchronously from
`initSidebarDetach()`.

The boot watchdog cannot catch that one — it is a `setTimeout`, and a
synchronous `init()` never yields the timer queue. Fail-safes instead live in the
modules:

| Guard | Where |
| --- | --- |
| Re-applying unchanged geometry performs **no** DOM writes, so an echoed re-clamp is a no-op and the cycle terminates | `applyDetachedGeometry()` in `js/sidebarDetach.js` |
| Broadcast only when the dock-relevant class signature (`is-collapsed` / `is-detached`) changes, coalesced into one frame | `bindDesktopBoundsWatcher()` in `js/toolsManager.js` |
| Re-entrancy guard plus a per-frame budget on the re-clamp | `reclampDetachedPanel()` in `js/sidebarDetach.js` |
| `sidebar:width_changed` only fires on a real width change | `applySidebarMetrics()` in `js/shellResize.js` |
| Emergency off switch: `false` makes the init return before binding anything or re-applying a stored detached state (it also clears the persisted flag and hides the toggle) | `SIDEBAR_DETACH_ENABLED` in `js/sidebarDetach.js` |
| Microtask-batched `MutationObserver` fake reproduces the loop in `node --test`; a storm guard turns a regression into a fast failure instead of a hung runner | `test/sidebarDetach.test.js` |

## Splitting a big module: facade + session modules

`js/drawingBoard.js` was 1874 lines of one object literal. It is now 939 lines of
facade plus `js/drawingBoard/{geometry,prefs,history,input,view,document,lifecycle}.js`,
and the same shape is the target for the other oversized files. The rules that
keep it reviewable:

| Rule | Why |
| --- | --- |
| The facade keeps the public object (`DrawingBoard`) and one-line delegates: `deactivate() { return LifecycleSession.deactivate(this); }` | Nothing outside the file changes, so imports, tests and the architecture map stay put. |
| A session module exports plain functions whose first argument is the facade instance (`export function deactivate(board)`, `board` where the method said `this`) | No shared mutable module state, no circular import, and the body stays testable with a stub board. |
| Move bodies **verbatim**: de-indent, rewrite `this` → `board`, change nothing else | Lets a mechanical diff prove equivalence instead of a reviewer re-reading 200 lines. Compare old body vs new body line by line before committing. |
| Re-create every import at `../` depth, including the specifiers inside `import('./x.js')` | Dynamic imports are resolved lazily, so a stale path links fine and only fails when that branch runs — this shipped once in `drawingBoard/document.js`. `npm run check:modules` now resolves them. |
| Drop imports the facade no longer uses | Left-behind imports make a module claim work it handed off. `test/noUnusedImports.test.js` guards the family. |
| Every module starts with `/** @module {"owns":"…","related":[…]} */` | `scripts/build-architecture-map.mjs` builds `.cursor/rules/magiclists-architecture.mdc` from it; a module without the header is invisible in the map. |
| Add a `test/drawingBoard<Session>.test.js` for the moved invariants, not the moved lines | The bodies already ran; what needs pinning is what callers relied on (state reset on entry, flush before teardown, gesture flags not leaking). |

Gate after each extraction: `npm run assets:stamp && node scripts/build-architecture-map.mjs && npm run verify`.

What deliberately stays in the facade: `init`, the tool and preference setters,
and the toolbar/DOM orchestration that every entry path needs — the seam the
sessions call back into. `activate`, `activateForNote` and `openNoteFlowchart`
still share an identical entry tail (chrome → toolbar mount → brand → aria →
`loadFromDoc` → hand mode → `dataset.tool` → `shrinkInfiniteIfNeeded` →
`renderToolbar` → `updateZoomLevel` → `resize` → `redraw`); deduping it is its
own commit, with the lifecycle tests as the safety net.

### Variation: stateless modules instead of sessions

`js/fileCabinet.js` (2965 lines) is the second file split this way, but its
ordering layer is plain module functions taking arguments — no `this`, no shared
state — so `js/fileCabinet/order.js` needs no facade instance and the facade
uses a straight interop block instead of delegates:

```js
import { addToFileCabinetOrder, /* … */ } from './fileCabinet/order.js';
export { addToFileCabinetOrder, /* … */ };
export { saveFiledCabinetLayout, /* keys */ } from './fileCabinet/order.js';
```

`import` + `export { … }` re-exports the *same* function object, so `ui.js`,
`dragdrop.js` and `layoutStorage.js` keep importing from `./fileCabinet.js` with
no change and no wrapper layer to drift. The four `FILE_CABINET_*_KEY`
constants moved with the storage they guard and are re-exported the same way —
a key that lives away from its reader is how the two sides silently diverge.

Two boundaries worth keeping:

- `moveItemBetweenCategories` stays in the facade. It needs `NoteSurface`, and
  `noteSurface.js` imports `fileCabinet.js` — moving it would close the cycle
  `order.js → noteSurface.js → fileCabinet.js → order.js`. ESM survives that
  (the binding is only read inside a function), but a needless cycle is worse
  than one function left behind.
- The module's private helpers (`isCollapsedForFileCabinet`,
  `isSpatiallyEligibleForFileCabinet`, `resolveFileCabinetItemPosition`,
  `sortItemsByFileCabinetOrder`) are **not** re-exported. Only the last one is
  exported from `order.js` at all, because the facade's renderer still calls it.
  `test/fileCabinetOrder.test.js › module boundary` asserts the public list is
  identity-equal to `order.js` and that the internals are absent from the
  facade, so neither drift nor surface creep passes silently.

The move also dropped a dead line: `saveFiledCabinetLayout` computed
`normalizeViewMode(sortBy)` into a binding nothing read (the stored entry is
only `w`/`h`/`x`/`y`), which is why it no longer takes a sort mode.

#### The rest of the file, in dependency order

The first slice was easy because ordering sits at the bottom of the graph. The
drag layer sits at the top: `initFileCabinetDrag` calls the rail initializers,
which call the renderer, which measures against the drawer geometry. Extracting
the biggest chunk first would have made `drag.js` import from the facade that
imports it, so the remaining slices went bottom-up, each green and committed on
its own:

| module | owns | facade |
| --- | --- | --- |
| `layout.js` | cascade geometry, drawer height, UI scale, stack positioner | 2589 → 2438 |
| `chrome.js` | active/shut flags, persisted height, mount, drawer-height sync | 2438 → 2316 |
| `transfer.js` | board↔drawer transfers, drawer→drawer move | 2316 → 2155 |
| `render.js` | rail + open-drawer markup, tab drag handle | 2155 → 1907 |
| `categoryRail.js` | fold/rename/color/hide/open-all, shelf→desktop drag | 1907 → 1390 |
| `drag.js` | ghosts, drop targeting, insert markers, shut snap | 1390 → 331 |

`drag.js` also holds the only mutable module state left in the split:
`activeDropHighlightKey`. It moved with the two functions that read and write it
(`applyFileCabinetDropHighlight`, `clearFileCabinetDropTargets`), so no other
module has to hold a reference to it — the highlight cache stays one value in one
module instead of being shared through the facade.

Two cycles are deliberate and pre-existing, both deferred-binding only:
`fileCabinet.js ↔ noteSurface.js` (which is why `transfer.js`, the module that
edits live items, owns `moveItemBetweenCategories` and nothing in the facade
calls into it at import time) and `fileCabinet.js ↔ shellResize.js` (chrome and
render need the splitter/FAB chrome, `shellResize.js` needs the constants).
`npm run check:modules` links the graph; the free-identifier scan proves every
moved module resolves its own names.

The payoff is measurable: the facade is 331 lines of exported surface plus four
board-side helpers, and every extracted module has a characterization suite
pinning the behaviour that used to be reachable only by dragging cards in a
browser — `fileCabinetLayout`, `fileCabinetTransfer`, `fileCabinetCategoryRail`
and `fileCabinetDrag` were all added during the split, taking the cabinet from
zero drag coverage to 1012 tests overall.


