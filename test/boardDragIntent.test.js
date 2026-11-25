// test/boardDragIntent.test.js
// The board press decision used to live inline in a `mousedown` handler, where
// no test could reach it and where touch devices never got the chance to try:
// `mousedown` only arrives once a tap has resolved, and a finger produces no
// `mousemove`. The guard chain now lives in js/board/dragIntent.js so the rules
// that decide "resize / move / hold-then-move / do nothing" are pinned here.
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LONG_PRESS_MS,
  LONG_PRESS_SLOP,
  PRESS_INTENT,
  resolvePressIntent,
  longPressCancelled
} from '../js/board/dragIntent.js';

describe('resolvePressIntent', () => {
  it('starts a move immediately for a mouse press on a drag zone', () => {
    assert.deepEqual(
      resolvePressIntent({ pointerType: 'mouse', dragSurface: true }),
      { kind: PRESS_INTENT.DRAG }
    );
  });

  it('treats a pen like a mouse', () => {
    assert.deepEqual(
      resolvePressIntent({ pointerType: 'pen', dragSurface: true }),
      { kind: PRESS_INTENT.DRAG }
    );
  });

  it('defers a touch press on the header/gutter until the hold elapses', () => {
    assert.deepEqual(
      resolvePressIntent({ pointerType: 'touch', dragSurface: true }),
      { kind: PRESS_INTENT.LONG_PRESS, holdMs: LONG_PRESS_MS, slop: LONG_PRESS_SLOP }
    );
  });

  it('starts immediately from the grip on touch, because the grip is explicit', () => {
    assert.deepEqual(
      resolvePressIntent({ pointerType: 'touch', dragSurface: true, grip: true }),
      { kind: PRESS_INTENT.DRAG }
    );
  });

  it('resizes from a handle on touch as well', () => {
    assert.deepEqual(
      resolvePressIntent({ pointerType: 'touch', resizeAxis: 'se' }),
      { kind: PRESS_INTENT.RESIZE, axis: 'se' }
    );
  });

  it('lets the handle win over note text underneath it', () => {
    assert.deepEqual(
      resolvePressIntent({ pointerType: 'mouse', resizeAxis: 'n', yieldsToEditor: true }),
      { kind: PRESS_INTENT.RESIZE, axis: 'n' }
    );
  });

  it('never drags from note text or a checklist step grab', () => {
    assert.deepEqual(
      resolvePressIntent({ pointerType: 'mouse', dragSurface: true, yieldsToEditor: true }),
      { kind: PRESS_INTENT.NONE }
    );
    assert.deepEqual(
      resolvePressIntent({ pointerType: 'touch', dragSurface: true, grip: true, overStepGrab: true }),
      { kind: PRESS_INTENT.NONE }
    );
  });

  it('ignores a scrollbar grip inside a long note', () => {
    assert.deepEqual(
      resolvePressIntent({ pointerType: 'touch', dragSurface: true, grip: true, overScrollbarGrip: true }),
      { kind: PRESS_INTENT.NONE }
    );
  });

  it('leaves pinned cards inert, handles included', () => {
    assert.deepEqual(
      resolvePressIntent({ pointerType: 'mouse', dragSurface: true, grip: true, pinned: true }),
      { kind: PRESS_INTENT.NONE }
    );
    assert.deepEqual(
      resolvePressIntent({ pointerType: 'touch', resizeAxis: 'se', pinned: true }),
      { kind: PRESS_INTENT.NONE }
    );
  });

  it('does nothing when the press missed every drag surface', () => {
    assert.deepEqual(
      resolvePressIntent({ pointerType: 'mouse' }),
      { kind: PRESS_INTENT.NONE }
    );
  });

  it('defaults to mouse behaviour when no pointer type is given', () => {
    assert.deepEqual(
      resolvePressIntent({ dragSurface: true }),
      { kind: PRESS_INTENT.DRAG }
    );
  });
});

describe('longPressCancelled', () => {
  const origin = { x: 100, y: 200 };

  it('keeps the hold alive while the finger stays put', () => {
    assert.equal(longPressCancelled(origin, { x: 102, y: 203 }), false);
  });

  it('keeps the hold alive exactly at the slop boundary', () => {
    assert.equal(longPressCancelled(origin, { x: 100 + LONG_PRESS_SLOP, y: 200 }), false);
  });

  it('drops the hold once the finger travels far enough to be a scroll', () => {
    assert.equal(longPressCancelled(origin, { x: 100, y: 200 + LONG_PRESS_SLOP + 1 }), true);
    assert.equal(longPressCancelled(origin, { x: 100 - LONG_PRESS_SLOP - 1, y: 200 }), true);
  });

  it('honours a custom slop', () => {
    assert.equal(longPressCancelled(origin, { x: 104, y: 200 }, 3), true);
  });

  it('tolerates missing points', () => {
    assert.equal(longPressCancelled(null, { x: 0, y: 0 }), false);
    assert.equal(longPressCancelled(origin, null), false);
  });
});
