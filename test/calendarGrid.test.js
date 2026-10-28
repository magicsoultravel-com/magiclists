// test/calendarGrid.test.js
// Calendar month / year grid: Sunday-start week rows with ISO week numbers, and
// the Sunday + holiday "red day" rule (Saturdays are ordinary days again). The
// rule only colours the day number red - cells keep their own background.
//
// js/calendar.js is a browser module, but the two pieces covered here are pure:
// buildMonthWeekRows() is a plain function, and getRedDayInfo() only reads
// Holidays, which is initialised from localStorage at import time - hence the
// stub below (same shape as test/sidebarPrefs.test.js) and the dynamic import.
//
// Run with: npm test  (node --test)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => void memory.set(key, String(value)),
    removeItem: (key) => void memory.delete(key),
    clear: () => memory.clear(),
    key: (index) => [...memory.keys()][index] ?? null,
    get length() {
        return memory.size;
    }
};

const { buildMonthWeekRows, Calendar } = await import('../js/calendar.js');
const { Holidays } = await import('../js/holidays.js');

describe('calendar · buildMonthWeekRows', () => {
    it('returns full seven-day rows that cover every day exactly once', () => {
        for (const year of [2024, 2026]) {
            for (let month = 0; month < 12; month++) {
                const rows = buildMonthWeekRows(year, month);
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const seen = [];

                for (const row of rows) {
                    assert.equal(row.cells.length, 7, `${year}-${month + 1} row width`);
                    seen.push(...row.cells.filter((day) => day !== null));
                }

                assert.deepEqual(
                    seen,
                    Array.from({ length: daysInMonth }, (_, i) => i + 1),
                    `${year}-${month + 1} day order`
                );
            }
        }
    });

    it('pads the first row so that every row starts on a Sunday', () => {
        // 1 Oct 2026 is a Thursday, so four leading cells are padding.
        assert.deepEqual(buildMonthWeekRows(2026, 9)[0].cells, [null, null, null, null, 1, 2, 3]);
    });

    it('has no padding when the month starts on a Sunday', () => {
        // 1 Nov 2026 is a Sunday.
        const rows = buildMonthWeekRows(2026, 10);
        assert.deepEqual(rows[0].cells, [1, 2, 3, 4, 5, 6, 7]);
        assert.deepEqual(rows[rows.length - 1].cells, [29, 30, null, null, null, null, null]);
    });

    it('numbers rows with the ISO week of the row Monday', () => {
        // January 2026 starts on a Thursday: the ISO year 2026 opens with the
        // week of Mon 29 Dec 2025, so the five rows are weeks 1..5.
        assert.deepEqual(buildMonthWeekRows(2026, 0).map((row) => row.week), [1, 2, 3, 4, 5]);
        // December 2020 sits in a 53-week ISO year; 1 Dec 2020 is a Tuesday.
        assert.deepEqual(buildMonthWeekRows(2020, 11).map((row) => row.week), [49, 50, 51, 52, 53]);
    });

    it('increments the week number by exactly one row by row', () => {
        for (const week of buildMonthWeekRows(2026, 5).map((row) => row.week)) {
            assert.ok(week >= 1 && week <= 53, `June 2026 week ${week}`);
        }
        const rows = buildMonthWeekRows(2026, 5);
        for (let i = 1; i < rows.length; i++) {
            assert.equal(rows[i].week, rows[i - 1].week + 1);
        }
    });

    it('keeps every week number inside 1..53 across a 53-week year', () => {
        for (let month = 0; month < 12; month++) {
            for (const row of buildMonthWeekRows(2020, month)) {
                assert.ok(row.week >= 1 && row.week <= 53, `${month + 1}: week ${row.week}`);
            }
        }
    });

    it('covers 29 February of a leap year', () => {
        const rows = buildMonthWeekRows(2024, 1);
        assert.ok(rows.some((row) => row.cells.includes(29)));
        assert.equal(rows.flatMap((row) => row.cells).filter((day) => day !== null).length, 29);
    });
});

describe('calendar · red days', () => {
    beforeEach(() => {
        memory.clear();
    });

    it('marks Sundays red', () => {
        assert.deepEqual(Calendar.getRedDayInfo(new Date(2026, 10, 1)), {
            isRed: true,
            holidayName: null
        });
    });

    it('leaves Saturdays alone', () => {
        assert.deepEqual(Calendar.getRedDayInfo(new Date(2026, 10, 7)), {
            isRed: false,
            holidayName: null
        });
    });

    it('marks the holidays of the selected country red', () => {
        Holidays.setCountry('PL');
        assert.deepEqual(Calendar.getRedDayInfo(new Date(2026, 10, 11)), {
            isRed: true,
            holidayName: 'Independence Day'
        });
        assert.equal(Calendar.getRedDayInfo(new Date(2026, 10, 12)).isRed, false);
    });

    it('follows the country selected in the calendar toolbar', () => {
        // The US call 11 November "Veterans Day"; Poland calls it Independence Day.
        assert.deepEqual(Calendar.getRedDayInfo(new Date(2026, 10, 11)), {
            isRed: true,
            holidayName: 'Veterans Day'
        });
        assert.equal(Calendar.getRedDayInfo(new Date(2026, 11, 25)).holidayName, 'Christmas Day');

        Holidays.setCountry('PL');
        assert.deepEqual(Calendar.getRedDayInfo(new Date(2026, 10, 11)), {
            isRed: true,
            holidayName: 'Independence Day'
        });
    });
});
