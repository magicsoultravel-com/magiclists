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

### One binder per tray control

`#sidebar-collapse` is bound **once**, by `bindSidebarCollapse()` in
`js/sidebarDetach.js`. A second listener on the same element toggles
`.is-compact` on and straight back off, so the click looks dead — and
`stopPropagation()` cannot help, because sibling listeners on the same element
still run. That is why `initAllSidebarModules()` owns only the module-level tray
controls (`#sidebar-collapse-all`, `#sidebar-reset-size`,
`#sidebar-reattach-all`).

Compact mode itself is detached-only: `.is-compact` hides the module list and
chrome, and the tray control is `display: none` while docked, so
`setSidebarCompact()` no-ops unless the panel is floating and `reattachSidebar()`
clears the strip. The collapse remembers the sized height and re-applies it
through `applyDetachedGeometry()` on expand, so a corner resize survives the
trip through the one-row strip (and is re-persisted rather than written as
`height: null` by the next drag).

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

#### The same recipe on a pure-markup module

`js/noteSurfaceHtml.js` (1228 lines) is the opposite case: no mutable state, no
event wiring to speak of — just string builders. It went the same way, one slice
per commit, and ended as a **barrel**: 48 lines of `export { … } from`, no code of
its own.

| module | owns |
| --- | --- |
| `noteSurfaceHtml/quickActions.js` | the card toolbar string (board / modal / popout) |
| `noteSurfaceHtml/metaFooter.js` | footer markup + size/line/date stats |
| `noteSurfaceHtml/checklistMarkup.js` | expanded checklist, done section |
| `noteSurfaceHtml/body.js` | content field, bodies, side sections, rich-text helpers |
| `noteSurfaceHtml/shell.js` | title, format + config panels, shell assembly |
| `noteSurfaceHtml/card.js` | theme, category band, board card + in-place refreshers |

Ordering was forced by one edge: three body builders call
`buildExpandedChecklistHtml`, so the checklist had to leave before the body or
`body.js` would have had to import it back from the facade that imports `body.js`.

Two checks earned their keep here and are worth reusing:

- **Export-surface diff.** An acorn one-liner dumps every exported name of the
  file before and after a slice, and `diff` must be empty. It caught
  `fileCabinetStackPitch` (private, re-exported by accident) and
  `initFileCabinetCategoryColumnDrag` (same) — both invisible to the tests, both
  a silent widening of a public API that other modules compile against.
- **"No code left" assertion.** Once a facade is *only* re-exports, a test asserts
  the file has no top-level `function`/`const` at all, so a later "quick fix" can't
  quietly re-introduce logic into the barrel.

One trap, recorded because it cost a red build: a name used **only** by a local
`export { … };` block still needs its import. A pruner that strips export blocks
before deciding what is unused will delete real bindings (`buildChecklistRowHtml`);
treat re-export blocks as usage, and let the free-identifier scan be the judge.

#### The facade that was still doing six jobs

`js/noteSurfaceChecklist.js` (1332 lines) was the next one, and it is the middle
case: it does hold mutable state (the collapse cache) and it does wire events, so
it is not a pure-markup module — but five of its six jobs are independent enough
to leave one at a time. It ends as a 49-line barrel.

| module | owns | facade |
| --- | --- | --- |
| `noteSurfaceChecklist/rows.js` | markup for one step row: checkbox, text, collapse chevron, indent/outdent, copy/delete, tree guides | 1332 → 1256 |
| `noteSurfaceChecklist/collapse.js` | collapsed groups + done sections, expand/collapse-all toolbar, the 1s read cache | 1256 → 1140 |
| `noteSurfaceChecklist/targeting.js` | which rows are on screen, whether a row is a collapsed group, where a pointer lands | 1140 → 1049 |
| `noteSurfaceChecklist/ops.js` | insert/remove plus the Backspace/Delete/Enter key paths | 1049 → 655 |
| `noteSurfaceChecklist/drag.js` | pointer drag: ghosts, insert bounds, one committed reorder | 655 → 379 |
| `noteSurfaceChecklist/interactions.js` | the delegated click/change/keydown handler, the drag hit-test | 379 → 49 |

The order is the dependency graph read bottom-up, same as the cabinet: `rows` and
`collapse` have no sibling dependencies, `targeting` reads `collapse`, `ops` needs
both (`insertStepRowInDom` renders through the row builder, Enter consults the
collapsed keys), and `drag`/`interactions` sit on top of everything. Extracting
the 284-line click handler first would have had it importing from the facade that
imports it.

Three things this split taught that the earlier ones did not:

- **A performance cache can become an API.** The one-second collapse cache was
  four file-local bindings; after the move `drag.js` is the only thing that calls
  `getCachedChecklistCollapsedKeys`/`invalidateChecklistCache`, so they had to be
  exported by `collapse.js`. Because the cache is time-based rather than
  write-through, a drop that opens a group *must* invalidate it explicitly — the
  reset state is pinned by test rather than left to the TTL.
- **Queries deserve their own module.** `getActiveRows`, `isCollapsedGroupRow` and
  `findStepInsertionPosition` mutate nothing, so they fit neither `collapse`
  (state) nor `ops` (mutation). Left in either, `drag.js` and `interactions.js`
  would each have needed a private copy. `targeting.js` is 103 lines and both
  import it — and it is the module where "visible" finally has a definition
  worth testing (collapsed group, other item's collapse key, shut done section,
  ghost rows without a step id).
- **Cross-module drift is testable.** `isChecklistInteraction` is a hard-coded
  selector list that has to keep matching classes the markup emits — if it slips,
  drag steals the pointer from a control nobody claims any more. The suite now
  renders a row and the expanded-checklist body and asserts every claimed class
  is still emitted. Same idea as the export-surface diff, applied to selectors
  instead of names.

The barrel check got one line stricter than the `noteSurfaceHtml` version: after
the last slice the facade must contain no `import` at all, not merely no
`function`/`const` — a re-export block needs a local import only if something
still uses the name, so a leftover `import` is the tell that code is trying to
move back in.


#### When the module owns a singleton instead of a set of builders

`js/magicFocus.js` (1801 lines) was the other shape: 385 lines of pure helpers on
top of one 1434-line object literal, `export const MagicFocus = { … }`. It went the
same way, bottom-up, and ended as a 186-line facade — every method a one-line
delegate to a session module.

| module | owns | facade |
| --- | --- | --- |
| `magicFocus/model.js` | block catalogue, preset tables, zone/ratio/zoom normalisation | 1801 → 1660 |
| `magicFocus/layout.js` | preset → CSS grid strings + splitter descriptors | 1660 → 1575 |
| `magicFocus/paneMarkup.js` | the body markup one pane renders (checklist, planner, media) | 1575 → 1494 |
| `magicFocus/setup.js` | the two-step setup wizard and the draft it edits | 1494 → 1270 |
| `magicFocus/panes.js` | pane chrome, zoom, expand, fill, hosted drawing board | 1270 → 834 |
| `magicFocus/splitters.js` | mounting, positioning and dragging the resize handles | 834 → 732 |
| `magicFocus/render.js` | header, work surface, ephemeral spawn view | 732 → 538 |
| `magicFocus/lifecycle.js` | open/close/toggle, shell morph, escape key, item resolution | 538 → 186 |

The three helpers are plain moves. Everything from `setup.js` down is a **session**
module in the `drawingBoard` sense — `export function open(magicFocus, item, opts)`,
bodies de-indented with `this` → `magicFocus`, and a delegate left behind:

```js
async open(item, opts = {}) { return LifecycleSession.open(this, item, opts); },
```

Two details are worth copying and one is worth avoiding:

- **Name the instance after the singleton.** The obvious `focus` collides: these
  bodies already use `const focus = normalizeFocus(item.focus)` for the *layout
  model* in several methods, and that only surfaces when those methods move
  ("Identifier 'focus' has already been declared"). `magicFocus` can never collide,
  which is also why the cabinet uses `board`.
- **Cross-session calls go back through the facade.** Inside a moved body `this.foo()`
  became `magicFocus.foo()`, which lands on the delegate and dispatches to whichever
  session owns `foo`. No session imports another, so the graph stays a star and no
  load-order cycle can appear as slices land; `test/magicFocusFacade.test.js` asserts
  it.
- ...and the trap: **destructured parameters cannot be forwarded positionally.**
  `open(item, { forceSetup = false } = {})` needs the session to keep the original
  destructuring (`(magicFocus, item, { forceSetup = false } = {})`) while the
  delegate must give the argument a name (`opts = {}`) to pass it on. Getting this
  wrong produces a delegate whose call site is a syntax error, or — worse — a
  signature that parses but leaves `forceSetup` unresolved inside the body. The
  first is caught by `check:modules`; the second only by
  `test/freeIdentifierScan.test.js`, which is the reason that test exists.

The lazy imports needed the same depth fix as `paneMarkup.js` and `panes.js`
(`./plannerUi.js`, `./drawingBoard.js`, `./drawingToolbarChrome.js`,
`./noteAttachmentsUi.js`, `./toast.js`, `./mediaLibraryOverlay.js`,
`./flowchartUi.js`). Nine new suites came out of the split — `magicFocusModel`,
`magicFocusLayout`, `magicFocusPaneMarkup`, `magicFocusSetup`, `magicFocusPanes`,
`magicFocusSplitters`, `magicFocusRender`, `magicFocusLifecycle` and
`magicFocusFacade` — taking the file from no coverage of its internals to 125 tests
that need no browser: only the pointer gestures (drag, splitter drag) and anything
that requires a real `<template>` stay browser-only.


#### The board facade: 121 methods, six importers, no browser

`js/ui.js` was the last monolithic facade — 1894 lines, one object literal of 121
methods, and six modules importing `UI` (`dragdrop`, `app`, `hamburger`,
`editor`, `desktopCardManager`, `noteQuickActions`). Unlike `MagicFocus` it had no
helper layer to start from: all 1533 body lines were methods, and nothing could be
called without a mounted board.

| module | owns | lines |
| --- | --- | --- |
| `ui/boardState.js` | the two module-level bindings: the id → item lookup `render()` refills and the view mode the spatial layer falls back to | 37 |
| `ui/gridPack.js` | expansion classification, item sizing, the zero-gap rect solver behind sort/reset, the spatial sort helper | 409 |
| `ui/spatial.js` | rect resolution, collapse/expand tiers, resize and toggle wiring, freeform/grid storage, pins, canvas extents, mode switch | 1198 |
| `ui/render.js` | canvas prep, view state, item partition, layout and card creation, post-render finalize | 218 |
| `js/ui.js` | the state seam plus one-line delegates into the four | 240 |

The split added 138 tests in six suites (`uiFacade`, `uiBoardState`, `uiGridPack`,
`uiSpatialGeometry`, `uiSpatialStorage`, `uiRender`), no browser required: the
sessions take the receiver as their first argument (`Spatial.commitSpatialRect(ui,
…)`), so `ui` can be a double. `uiFacade` freezes the surface — export list, the
121 method names and every `Function.length` — and asserts the structural rules
that keep the facade thin (one-statement delegates, no module-level state, no
session importing the facade).

What was worth knowing before starting:

- **A method can shadow the state it reads.** `getViewState()` declared
  `const activeBoardViewMode = 'grid'` *inside* the method, shadowing the module
  binding of the same name. It had to move verbatim; "cleaning it up" would have
  changed what the function returns.
- **A property that never existed.** `fileCabinet.js` and
  `fileCabinet/transfer.js` read `UI.activeBoardViewMode`. `UI` never had that
  property — the reads were always `undefined` and the callers fell back. Adding
  it would have switched on a code path that has never run.
- **One duplicate, two owners.** `prepareBoardItems` existed byte-for-byte in
  both `fileCabinet.js` and `ui.js`, and `ui.js` imported the cabinet copy without
  ever calling it. The facade's version is gone; `ui/render.js` wraps the cabinet
  implementation (its fifth positional argument is the UI object, ours is the
  receiver first), so there is one body again.
- **A predicate with six new callers.** `isDesktopCard` was a 4-line export of
  `ui.js` that six of the extracted spatial methods call by name. Importing it back
  from the facade would have made `spatial.js` part of a load-order cycle, so it
  moved to `desktopManager.js` (the state it reads) and `ui.js` re-exports it — same
  identity, same surface.
- **Indentation is not a boundary.** Two methods sat at column 0 inside the object
  literal, and every parameter list with destructuring defaults spans several
  lines. Moving by indent regex drops them silently; the slices were generated from
  acorn spans instead, and each one was proven with an AST comparison of the old
  method body against the new function (only `this` → `ui` may differ).
- **`\bthis\b` is not `this`.** One method body contains the word "this" in a
  comment ("…owns this note…"). Rewriting ThisExpression nodes by offset keeps the
  comment; a word-boundary regex turns it into "owns ui note".
- **A moved wrapper can shadow its own import.** `getGridBoardBounds(canvas) {
  return getGridBoardBounds(canvas); }` was fine inside the object literal: bare
  names resolve to the *imported* boardExtents function, not to the method key
  (keys are not bindings). In a module where the wrapper is itself named
  `getGridBoardBounds`, the same line recurses forever. Eight forwarders landed
  that way and every guard passed — `freeIdentifierScan` sees a resolved
  identifier, the AST body comparison sees identical text, and the suites call
  `ui.getGridBoardBounds` on a double rather than the wrapper. Aliasing the import
  (`getGridBoardBounds as getGridBoardBoundsCore`) fixed it; `uiFacade` now asserts
  that a session never declares a function under the name of something it imports,
  and that no extracted wrapper calls itself. The catch came from a scripted
  end-to-end smoke (`UI.render` → `UI.sortBoardLayout` → `UI.resetBoardLayout` on a
  DOM double), not from a unit test.
- **State that is replaced, not mutated.** `render()` clears the item map and then
  assigns a *new* `Map`, so `boardState.js` needs `replaceBoardItemsMap`, not only
  `set`/`delete` on a captured reference.

`test/noUnusedImports.test.js` now guards `js/ui.js` and `js/ui/*`: after the last
slice the facade had no business importing 120 of the names it started with, and a
stale import list is what makes a thin facade look like it still owns the board.
