// test/boardTouchDragWiring.test.js
// Contract tests for touch dragging on the board: the engine must speak pointer
// events (a finger emits no `mousemove`, and iOS only synthesizes `mousedown`
// once a tap has resolved), and each affordance must declare the `touch-action`
// that lets it win or lose the gesture deliberately:
//   - grip + resize handles: `none`  (the press is a drag/resize, never a scroll)
//   - header/gutter drag zones: `pan-y` (a swipe still scrolls the board)
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Rule blocks as { selector, body }; at-rules skipped. */
function extractRules(css) {
  const clean = stripComments(css);
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(clean)) !== null) {
    const selector = match[1].trim();
    if (!selector || selector.startsWith('@')) continue;
    rules.push({ selector, body: match[2] });
  }
  return rules;
}

function declarations(body) {
  const out = {};
  for (const chunk of body.split(';')) {
    const idx = chunk.indexOf(':');
    if (idx === -1) continue;
    out[chunk.slice(0, idx).trim().toLowerCase()] = chunk.slice(idx + 1).trim().replace(/\s*!important$/, '');
  }
  return out;
}

/** Every declaration touching `selector` across the given stylesheets, in load order. */
function declarationsFor(sheets, selector) {
  const out = [];
  for (const name of sheets) {
    for (const rule of extractRules(read(`css/${name}`))) {
      const parts = rule.selector.split(',').map((part) => part.trim());
      if (!parts.includes(selector)) continue;
      out.push({ file: name, decls: declarations(rule.body) });
    }
  }
  return out;
}

function assertTouchAction(sheets, selector, expected) {
  const hits = declarationsFor(sheets, selector).filter((hit) => 'touch-action' in hit.decls);
  assert.ok(hits.length > 0, `${selector} declares no touch-action in ${sheets.join(', ')}`);
  for (const hit of hits) {
    assert.equal(
      hit.decls['touch-action'],
      expected,
      `${selector} in css/${hit.file} should be touch-action: ${expected}`
    );
  }
}

describe('touch-action contract', () => {
  it('resize handles claim the finger outright', () => {
    // Shared chrome: board cards, tool panels, media/category panels.
    assertTouchAction(['base.css'], '.ff-resize', 'none');
    assertTouchAction(['board.css'], '#app-canvas.view-grid .mini-card .ff-resize', 'none');
  });

  it('the grip handle claims the finger outright', () => {
    assertTouchAction(['cards.css'], '.card-act--drag', 'none');
    assertTouchAction(['shell-editor.css'], '.card-act--drag', 'none');
  });

  it('the header drag zone leaves vertical scrolling to the board', () => {
    assertTouchAction(['board.css'], '#app-canvas.view-grid .card-drag-zone', 'pan-y');
  });

  it('the freeform gutter leaves vertical scrolling to the board', () => {
    assertTouchAction(['board.css'], '#app-canvas.view-grid .mini-card .ff-drag-gutter', 'pan-y');
  });

  it('suppresses the iOS long-press callout on drag affordances', () => {
    const zones = declarationsFor(['board.css'], '#app-canvas.view-grid .card-drag-zone');
    assert.ok(
      zones.some((hit) => hit.decls['-webkit-touch-callout'] === 'none'),
      'header drag zone should suppress the touch callout'
    );
    const grips = declarationsFor(['cards.css'], '.card-act--drag');
    assert.ok(
      grips.some((hit) => hit.decls['-webkit-touch-callout'] === 'none'),
      'grip should suppress the touch callout'
    );
  });
});

describe('board move/resize pointer session', () => {
  const engine = read('js/dragdrop.js');

  it('starts sessions from pointerdown, not mousedown', () => {
    assert.match(engine, /card\.addEventListener\('pointerdown'/);
    assert.doesNotMatch(engine, /addEventListener\('mousedown'/);
  });

  it('drives sessions from pointermove/pointerup, never mousemove/mouseup', () => {
    assert.match(engine, /addEventListener\('pointermove'/);
    assert.match(engine, /addEventListener\('pointerup'/);
    assert.doesNotMatch(engine, /addEventListener\('mousemove'/);
    assert.doesNotMatch(engine, /addEventListener\('mouseup'/);
  });

  it('unwinds cancelled pointers through the same "up" handler', () => {
    assert.match(engine, /addEventListener\('pointercancel', up\)/);
    assert.match(engine, /removeEventListener\('pointercancel', session\.up\)/);
  });

  it('routes the press decision through the pure intent module', () => {
    assert.match(engine, /import \{[^}]*resolvePressIntent[^}]*\} from '\.\/board\/dragIntent\.js'/);
    assert.match(engine, /resolvePressIntent\(/);
    assert.match(engine, /PRESS_INTENT\.LONG_PRESS/);
  });

  it('cancels the scroll once a long press has become a move', () => {
    assert.match(engine, /addEventListener\('touchmove', preventTouchScroll, \{ passive: false, capture: true \}\)/);
  });

  it('swallows the synthesized tap that follows a touch drag', () => {
    assert.match(engine, /swallowClickOn\(card\)/);
  });
});
