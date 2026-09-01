// test/alphabetsData.test.js
// Validates the alphabets tool data: every cell that is expected to "read out"
// must carry a native speak text (and, for scripts that browsers often lack a
// voice for, a romanized English fallback). Also checks the Japanese
// dakuten/handakuten rows are wired up correctly.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ALPHABETS } from '../js/tools/alphabets-data.js';
import {
    THAI_CONSONANTS,
    THAI_VOWELS,
    HIEROGLYPHS_100,
    hieroSound,
} from '../js/tools/alphabets-data-ext.js';

const pageById = (id) => ALPHABETS.find((page) => page.id === id);

describe('alphabets tool data', () => {
    it('Thai consonants and vowels all carry a native speak text + English fallback', () => {
        assert.equal(THAI_CONSONANTS.length, 44, '44 Thai consonants');
        for (const entry of THAI_CONSONANTS) {
            assert.ok(entry.speak, `Thai consonant ${entry.char} needs speak`);
            assert.ok(entry.speakEn, `Thai consonant ${entry.char} needs speakEn`);
        }
        assert.equal(THAI_VOWELS.length, 26, '26 Thai vowel marks');
        for (const entry of THAI_VOWELS) {
            assert.ok(entry.speak, `Thai vowel ${entry.char} needs speak`);
            assert.ok(entry.speakEn, `Thai vowel ${entry.char} needs speakEn`);
        }
    });

    it('Hebrew letters carry Hebrew names + English fallback', () => {
        const page = pageById('hebrew');
        assert.ok(page, 'hebrew page exists');
        for (const entry of page.chars) {
            assert.ok(entry.speak, `Hebrew ${entry.char} needs speak`);
            assert.ok(entry.speakEn, `Hebrew ${entry.char} needs speakEn`);
        }
    });

    it('Arabic letters carry Arabic names + English fallback', () => {
        const page = pageById('arabic');
        assert.ok(page, 'arabic page exists');
        for (const letter of page.letters) {
            assert.ok(letter.speak, `Arabic ${letter.isolated} needs speak`);
            assert.ok(letter.speakEn, `Arabic ${letter.isolated} needs speakEn`);
        }
    });

    it('Tamil characters carry an English fallback for when no ta voice is installed', () => {
        const page = pageById('tamil');
        assert.ok(page, 'tamil page exists');
        for (const entry of page.chars) {
            assert.ok(entry.speakEn, `Tamil ${entry.char} needs speakEn`);
        }
    });

    it('IPA vowels & pulmonic consonants all carry an example word to speak', () => {
        const page = pageById('ipa');
        assert.ok(page, 'ipa page exists');
        assert.equal(page.sections[0].chars.length, 29, '29 IPA vowels');
        assert.equal(page.sections[1].chars.length, 59, '59 pulmonic consonants');
        for (const section of page.sections.slice(0, 2)) {
            for (const entry of section.chars) {
                assert.ok(entry.speak, `IPA ${entry.char} (${entry.roman}) needs a speak example`);
                if (entry.lang) {
                    assert.ok(/^[a-z]{2}(-[A-Z]{2})?$/.test(entry.lang), `IPA ${entry.char} has valid lang ${entry.lang}`);
                }
            }
        }
    });

    it('hieroglyphs carry a spoken pronunciation hint for every sign', () => {
        assert.equal(HIEROGLYPHS_100.length, 100, '100 hieroglyph signs');
        for (const entry of HIEROGLYPHS_100) {
            assert.ok(entry.speak, `Hieroglyph ${entry.char} (${entry.roman}) needs a speak hint`);
        }
        assert.equal(hieroSound('anx'), 'ankh');
        assert.equal(hieroSound('htp'), 'hotep');
        assert.equal(hieroSound('a'), 'ah');
        assert.equal(hieroSound('Hm'), 'hem');
    });

    it('Japanese page includes dakuten and handakuten rows in both scripts', () => {
        const page = pageById('japanese');
        assert.ok(page, 'japanese page exists');
        assert.equal(page.rows.length, 10, '10 gojūon rows');
        assert.equal(page.rowsDakuten.length, 4, '4 dakuten rows (ga/za/da/ba)');
        assert.equal(page.rowsHandakuten.length, 1, '1 handakuten row (pa)');
        assert.equal(page.rowsKatakanaDakuten.length, page.rowsDakuten.length);
        assert.equal(page.rowsKatakanaHandakuten.length, page.rowsHandakuten.length);

        const sum = (rows) => rows.reduce((acc, row) => acc + row.chars.length, 0);
        assert.equal(sum(page.rows), 46, '46 basic hiragana');
        assert.equal(sum(page.rowsDakuten), 20, '20 dakuten hiragana');
        assert.equal(sum(page.rowsHandakuten), 5, '5 handakuten hiragana');
        page.rowsDakuten.forEach((row, i) => {
            assert.equal(row.chars.length, page.rowsKatakanaDakuten[i].chars.length);
        });
    });
});

