/** @module {"owns":"preset-to-grid translation - the CSS grid-template strings and the splitter descriptors each preset needs (columns, rows, areas, and where each handle sits)", "related":["magicFocus.js","magicFocus/model.js","magicFocus/splitters.js"]} */

import { normalizeFocus, createDefaultFocus } from './model.js';

export function frPair(ratio) {
    const a = Math.max(0.08, Math.min(0.92, ratio));
    return `${a}fr ${1 - a}fr`;
}

export function frTriple(r0, r1) {
    const a = Math.max(0.08, Math.min(0.84, r0));
    const b = Math.max(a + 0.08, Math.min(0.92, r1));
    const p0 = a;
    const p1 = b - a;
    const p2 = 1 - b;
    return `${p0}fr ${p1}fr ${p2}fr`;
}

export function layoutForFocus(focus) {
    const f = normalizeFocus(focus) || createDefaultFocus();
    const r = f.ratios;
    switch (f.preset) {
        case 'split2-v':
            return {
                columns: frPair(r[0] ?? 0.5),
                rows: '1fr',
                areas: '"z0 z1"',
                splitters: [{ type: 'col', ratioIndex: 0, pos: r[0] ?? 0.5 }]
            };
        case 'split2-h':
            return {
                columns: '1fr',
                rows: frPair(r[0] ?? 0.5),
                areas: '"z0" "z1"',
                splitters: [{ type: 'row', ratioIndex: 0, pos: r[0] ?? 0.5 }]
            };
        case 'split3-cols':
            return {
                columns: frTriple(r[0] ?? 1 / 3, r[1] ?? 2 / 3),
                rows: '1fr',
                areas: '"z0 z1 z2"',
                splitters: [
                    { type: 'col', ratioIndex: 0, pos: r[0] ?? 1 / 3 },
                    { type: 'col', ratioIndex: 1, pos: r[1] ?? 2 / 3 }
                ]
            };
        case 'split3-rows':
            return {
                columns: '1fr',
                rows: frTriple(r[0] ?? 1 / 3, r[1] ?? 2 / 3),
                areas: '"z0" "z1" "z2"',
                splitters: [
                    { type: 'row', ratioIndex: 0, pos: r[0] ?? 1 / 3 },
                    { type: 'row', ratioIndex: 1, pos: r[1] ?? 2 / 3 }
                ]
            };
        case 'split3-1over2':
            return {
                columns: frPair(r[1] ?? 0.5),
                rows: frPair(r[0] ?? 0.45),
                areas: '"z0 z0" "z1 z2"',
                splitters: [
                    { type: 'row', ratioIndex: 0, pos: r[0] ?? 0.45 },
                    { type: 'col', ratioIndex: 1, pos: r[1] ?? 0.5, band: 'bottom' }
                ]
            };
        case 'split3-2over1':
            return {
                columns: frPair(r[1] ?? 0.5),
                rows: frPair(r[0] ?? 0.45),
                areas: '"z0 z1" "z2 z2"',
                splitters: [
                    { type: 'row', ratioIndex: 0, pos: r[0] ?? 0.45 },
                    { type: 'col', ratioIndex: 1, pos: r[1] ?? 0.5, band: 'top' }
                ]
            };
        case 'split4-grid':
        default:
            return {
                columns: frPair(r[0] ?? 0.5),
                rows: frPair(r[1] ?? 0.5),
                areas: '"z0 z1" "z2 z3"',
                splitters: [
                    { type: 'col', ratioIndex: 0, pos: r[0] ?? 0.5 },
                    { type: 'row', ratioIndex: 1, pos: r[1] ?? 0.5 }
                ]
            };
    }
}
