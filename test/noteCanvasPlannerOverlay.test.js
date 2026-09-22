import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createEmptyPlanner,
    setPlannerField,
    summarizePlannerSchedule
} from '../js/planner.js';
import {
    noteHasTextOverlayEnabled,
    measureNoteTextOverlay,
    buildNoteOverlayBlocks,
    estimateNoteTextOverlayBounds,
    ensureCanvasFitsNoteText
} from '../js/noteCanvasTextOverlay.js';
import {
    measurePlannerTableOverlay,
    measurePlannerChartOverlay,
    noteShowsPlannerTableOverlay,
    noteShowsPlannerChartOverlay
} from '../js/noteCanvasPlannerOverlay.js';
import { createEmptyNoteCanvas } from '../js/noteModel.js';
import { SHARED_FIELDS } from '../js/noteFieldOwnership.js';

function fakeMeasureCtx() {
    return {
        font: '',
        measureText(text) {
            return { width: String(text || '').length * 8 };
        }
    };
}

function noteWithPlanner(overrides = {}) {
    const planner = createEmptyPlanner();
    setPlannerField(planner.sheet, 0, 'name', 'Alpha');
    setPlannerField(planner.sheet, 0, 'start', '2026-03-01');
    setPlannerField(planner.sheet, 0, 'stop', '2026-03-05');
    setPlannerField(planner.sheet, 1, 'name', 'Beta');
    setPlannerField(planner.sheet, 1, 'start', '2026-03-04');
    setPlannerField(planner.sheet, 1, 'stop', '2026-03-10');
    return {
        id: 'n1',
        content: 'Hello body',
        steps: [{ id: 's1', text: 'Do thing', completed: false, level: 0 }],
        planner,
        plannerHidden: false,
        ...overrides
    };
}

describe('planner canvas overlay flags', () => {
    it('registers planner overlay flags as Shared', () => {
        assert.ok(SHARED_FIELDS.includes('canvasShowNotePlannerTable'));
        assert.ok(SHARED_FIELDS.includes('canvasShowNotePlannerChart'));
    });

    it('requires an active planner for planner overlay visibility', () => {
        const item = noteWithPlanner({
            canvasShowNotePlannerTable: true,
            canvasShowNotePlannerChart: true
        });
        assert.equal(noteShowsPlannerTableOverlay(item), true);
        assert.equal(noteShowsPlannerChartOverlay(item), true);

        item.plannerHidden = true;
        assert.equal(noteShowsPlannerTableOverlay(item), false);
        assert.equal(noteShowsPlannerChartOverlay(item), false);
        assert.equal(noteHasTextOverlayEnabled(item), false);
    });
});

describe('planner canvas overlay stacking', () => {
    it('stacks content → checklist → table → chart without overlapping heights', () => {
        const item = noteWithPlanner({
            canvasShowNoteContent: true,
            canvasShowNoteChecklist: true,
            canvasShowNotePlannerTable: true,
            canvasShowNotePlannerChart: true
        });
        const measured = measureNoteTextOverlay(item, fakeMeasureCtx());
        assert.deepEqual(
            measured.blocks.map((b) => b.kind),
            ['lines', 'plannerTable', 'plannerChart']
        );

        let cursor = measured.pad;
        for (let i = 0; i < measured.blocks.length; i++) {
            const block = measured.blocks[i];
            assert.ok(block.height > 0, `${block.kind} should have height`);
            if (i > 0) cursor += 16; // plannerOverlayBlockGap
            cursor += block.height;
        }
        assert.equal(measured.textHeight, cursor + measured.pad);
    });

    it('keeps note order even when only later layers are enabled first', () => {
        const chartOnly = noteWithPlanner({
            canvasShowNotePlannerChart: true
        });
        const chartThenTable = noteWithPlanner({
            canvasShowNotePlannerChart: true,
            canvasShowNotePlannerTable: true
        });
        const chartKinds = buildNoteOverlayBlocks(chartOnly, fakeMeasureCtx()).blocks.map((b) => b.kind);
        const bothKinds = buildNoteOverlayBlocks(chartThenTable, fakeMeasureCtx()).blocks.map((b) => b.kind);
        assert.deepEqual(chartKinds, ['plannerChart']);
        assert.deepEqual(bothKinds, ['plannerTable', 'plannerChart']);
    });

    it('does not contribute planner height when planner is inactive', () => {
        const item = noteWithPlanner({
            plannerHidden: true,
            canvasShowNotePlannerTable: true,
            canvasShowNotePlannerChart: true,
            canvasShowNoteContent: true
        });
        const measured = measureNoteTextOverlay(item, fakeMeasureCtx());
        assert.deepEqual(measured.blocks.map((b) => b.kind), ['lines']);
        assert.equal(measurePlannerTableOverlay(item, 20), null);
        assert.equal(measurePlannerChartOverlay(item, 20), null);
    });
});

describe('planner table overlay without stats', () => {
    it('measures sheet-only table and never includes summary span height', () => {
        const item = noteWithPlanner({ canvasShowNotePlannerTable: true });
        const measured = measurePlannerTableOverlay(item, 20);
        assert.ok(measured);
        assert.equal(measured.hasData, true);
        assert.ok(measured.geometry);

        // Summary exists on the planner model but is not part of the overlay measure.
        const summary = summarizePlannerSchedule(item.planner);
        assert.ok(summary);
        assert.ok(summary.calendarDays >= 1);

        // Height is header + body rows only (no extra stats band).
        assert.equal(
            measured.height,
            measured.geometry.rowHeight + measured.rows * measured.geometry.rowHeight
        );
    });
});

describe('planner overlay canvas fit', () => {
    it('grows infinite bounds when overlay exceeds current extent', () => {
        const item = noteWithPlanner({ canvasShowNotePlannerChart: true });
        const doc = createEmptyNoteCanvas();
        doc.infinite.bounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
        const bounds = estimateNoteTextOverlayBounds(item);
        assert.ok(bounds);
        assert.ok(bounds.maxX > 200 || bounds.maxY > 100);

        const changed = ensureCanvasFitsNoteText(doc, item);
        assert.equal(changed, true);
        assert.ok(doc.infinite.bounds.maxX >= bounds.maxX);
        assert.ok(doc.infinite.bounds.maxY >= bounds.maxY);
    });
});
