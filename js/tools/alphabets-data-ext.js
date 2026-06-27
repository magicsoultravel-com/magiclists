/** Extended alphabet pages — imported by alphabets-data.js (not a tool module). */

export const THAI_CONSONANTS = [
    { char: 'ก', roman: 'k' }, { char: 'ข', roman: 'kh' }, { char: 'ฃ', roman: 'kh' }, { char: 'ค', roman: 'kh' },
    { char: 'ฅ', roman: 'kh' }, { char: 'ง', roman: 'ng' }, { char: 'จ', roman: 'ch' }, { char: 'ฉ', roman: 'ch' },
    { char: 'ช', roman: 'ch' }, { char: 'ซ', roman: 's' }, { char: 'ฌ', roman: 'ch' }, { char: 'ญ', roman: 'y' },
    { char: 'ฎ', roman: 'd' }, { char: 'ฏ', roman: 't' }, { char: 'ฐ', roman: 'th' }, { char: 'ฑ', roman: 'th' },
    { char: 'ฒ', roman: 'th' }, { char: 'ณ', roman: 'n' }, { char: 'ด', roman: 'd' }, { char: 'ต', roman: 't' },
    { char: 'ถ', roman: 'th' }, { char: 'ท', roman: 'th' }, { char: 'ธ', roman: 'th' }, { char: 'น', roman: 'n' },
    { char: 'บ', roman: 'b' }, { char: 'ป', roman: 'p' }, { char: 'ผ', roman: 'ph' }, { char: 'ฝ', roman: 'f' },
    { char: 'พ', roman: 'ph' }, { char: 'ฟ', roman: 'f' }, { char: 'ภ', roman: 'ph' }, { char: 'ม', roman: 'm' },
    { char: 'ย', roman: 'y' }, { char: 'ร', roman: 'r' }, { char: 'ล', roman: 'l' }, { char: 'ว', roman: 'w' },
    { char: 'ศ', roman: 's' }, { char: 'ษ', roman: 's' }, { char: 'ส', roman: 's' }, { char: 'ห', roman: 'h' },
    { char: 'ฬ', roman: 'l' }, { char: 'อ', roman: 'o' }, { char: 'ฮ', roman: 'h' },
];

export const THAI_VOWELS = [
    { char: '–ะ', roman: 'a', gloss: 'with ก → ka' }, { char: '–ั', roman: 'a', gloss: 'short a' },
    { char: '–า', roman: 'aa', gloss: 'long a' }, { char: '–ิ', roman: 'i', gloss: 'short i' },
    { char: '–ี', roman: 'ii', gloss: 'long i' }, { char: '–ึ', roman: 'ue', gloss: 'short ue' },
    { char: '–ื', roman: 'uue', gloss: 'long ue' }, { char: '–ุ', roman: 'u', gloss: 'short u' },
    { char: '–ู', roman: 'uu', gloss: 'long u' }, { char: 'เ–ะ', roman: 'e', gloss: 'short e' },
    { char: 'เ–', roman: 'ee', gloss: 'long e' }, { char: 'แ–ะ', roman: 'ae', gloss: 'short ae' },
    { char: 'แ–', roman: 'aae', gloss: 'long ae' }, { char: 'โ–ะ', roman: 'o', gloss: 'short o' },
    { char: 'โ–', roman: 'oo', gloss: 'long o' }, { char: 'เ–าะ', roman: 'o', gloss: 'short o' },
    { char: '–อ', roman: 'oo', gloss: 'long o' }, { char: 'เ–อะ', roman: 'oe', gloss: 'short oe' },
    { char: 'เ–อ', roman: 'ooe', gloss: 'long oe' }, { char: '–ำ', roman: 'am', gloss: 'am' },
    { char: 'ไ–', roman: 'ai', gloss: 'ai' }, { char: 'ใ–', roman: 'ai', gloss: 'ai' },
    { char: 'เ–า', roman: 'ao', gloss: 'ao' }, { char: '–อย', roman: 'oi', gloss: 'oi' },
    { char: '–ว', roman: 'ua', gloss: 'ua' }, { char: '–ัว', roman: 'ua', gloss: 'ua' },
];

const HIERO_META = [
    ['a', 'seated man'], ['a', 'man'], ['a', 'man with hand'], ['a', 'man with staff'],
    ['t', 'woman'], ['t', 'woman pregnant'], ['t', 'woman with child'], ['s', 'god'],
    ['Hm', 'majesty'], ['nsw', 'king'], ['s', 'official'], ['sr', 'noble'],
    ['m', 'taste'], ['m', 'army'], ['x', 'enemy'], ['m', 'herdsman'],
    ['Hm', 'servant'], ['s', 'scribe'], ['sA', 'scribe kit'], ['m', 'stone mason'],
    ['w', 'farmer'], ['w', 'soldier'], ['n', 'king'], ['n', 'god with staff'],
    ['ir', 'eye'], ['irt', 'two eyes'], ['r', 'mouth'], ['r', 'leg'],
    ['a', 'arm'], ['d', 'hand'], ['d', 'arm with stick'], ['a', 'fist'],
    ['d', 'arm with flail'], ['a', 'arm holding'], ['d', 'hand with bowl'], ['d', 'arm with oar'],
    ['b', 'foot'], ['b', 'leg and foot'], ['b', 'toe'], ['b', 'pair of legs'],
    ['m', 'owl'], ['k', 'bull'], ['m', 'cat'], ['m', 'lion'],
    ['i', 'reed'], ['w', 'quail chick'], ['w', 'chick'], ['r', 'swallow'],
    ['b', 'honey bee'], ['n', 'water'], ['n', 'ripple'], ['y', 'reed leaf'],
    ['y', 'two reeds'], ['H', 'sedge'], ['r', 'sun'], ['nb', 'all'],
    ['gr', 'canal'], ['mw', 'water word'], ['s', 'pool'], ['s', 'folded cloth'],
    ['p', 'stool'], ['niwt', 'city'], ['htp', 'altar'], ['s', 'door bolt'],
    ['anx', 'life'], ['rd', 'placenta'], ['k', 'basket'], ['g', 'jar stand'],
    ['t', 'bread loaf'], ['s', 'stroke'], ['w', 'rabbit'], ['s', 'fold'],
    ['q', 'slope'], ['h', 'wick'], ['f', 'viper'], ['gg', 'goose'],
    ['k', 'belly'], ['kh', 'sieve'], ['m', 'owl sign'], ['i', 'reed (yod)'],
    ['r', 'mouth (r)'], ['p', 'stool (p)'], ['t', 'loaf (t)'], ['k', 'basket (k)'],
    ['y', 'yod'], ['n', 'n-water'], ['s', 's-cloth'], ['anx', 'ankh'],
    ['ra', 'sun disk'], ['niwt', 'city sign'], ['n', 'stream'], ['ir', 'eye pair'],
    ['d', 'hand (d)'], ['a', 'arm (a)'], ['w', 'quail'], ['f', 'viper (f)'],
    ['htp', 'hotep'], ['mw', 'water glyph'], ['nb', 'nebu'], ['q', 'hill'],
];

export const HIEROGLYPHS_100 = HIERO_META.map(([roman, gloss], i) => ({
    char: String.fromCodePoint(0x13000 + i),
    roman,
    gloss,
}));

export const MORSE_CODES = [
    { char: '·−', roman: 'A' }, { char: '−···', roman: 'B' }, { char: '−·−·', roman: 'C' },
    { char: '−··', roman: 'D' }, { char: '·', roman: 'E' }, { char: '··−·', roman: 'F' },
    { char: '−−·', roman: 'G' }, { char: '····', roman: 'H' }, { char: '··', roman: 'I' },
    { char: '·−−−', roman: 'J' }, { char: '−·−', roman: 'K' }, { char: '·−··', roman: 'L' },
    { char: '−−', roman: 'M' }, { char: '−·', roman: 'N' }, { char: '−−−', roman: 'O' },
    { char: '·−−·', roman: 'P' }, { char: '−−·−', roman: 'Q' }, { char: '·−·', roman: 'R' },
    { char: '···', roman: 'S' }, { char: '−', roman: 'T' }, { char: '··−', roman: 'U' },
    { char: '···−', roman: 'V' }, { char: '·−−', roman: 'W' }, { char: '−··−', roman: 'X' },
    { char: '−·−−', roman: 'Y' }, { char: '−−··', roman: 'Z' },
    { char: '−−−−−', roman: '0' }, { char: '·−−−−', roman: '1' }, { char: '··−−−', roman: '2' },
    { char: '···−−', roman: '3' }, { char: '····−', roman: '4' }, { char: '·····', roman: '5' },
    { char: '−····', roman: '6' }, { char: '−−···', roman: '7' }, { char: '−−−··', roman: '8' },
    { char: '−−−−·', roman: '9' },
];

export const NATO_WORDS = [
    { char: 'A', roman: 'Alpha' }, { char: 'B', roman: 'Bravo' }, { char: 'C', roman: 'Charlie' },
    { char: 'D', roman: 'Delta' }, { char: 'E', roman: 'Echo' }, { char: 'F', roman: 'Foxtrot' },
    { char: 'G', roman: 'Golf' }, { char: 'H', roman: 'Hotel' }, { char: 'I', roman: 'India' },
    { char: 'J', roman: 'Juliet' }, { char: 'K', roman: 'Kilo' }, { char: 'L', roman: 'Lima' },
    { char: 'M', roman: 'Mike' }, { char: 'N', roman: 'November' }, { char: 'O', roman: 'Oscar' },
    { char: 'P', roman: 'Papa' }, { char: 'Q', roman: 'Quebec' }, { char: 'R', roman: 'Romeo' },
    { char: 'S', roman: 'Sierra' }, { char: 'T', roman: 'Tango' }, { char: 'U', roman: 'Uniform' },
    { char: 'V', roman: 'Victor' }, { char: 'W', roman: 'Whiskey' }, { char: 'X', roman: 'X-ray' },
    { char: 'Y', roman: 'Yankee' }, { char: 'Z', roman: 'Zulu' },
];

const cp = (code) => String.fromCodePoint(code);

export const ELDER_FUTHARK = [
    { char: 'ᚠ', roman: 'fehu', gloss: 'f' }, { char: 'ᚢ', roman: 'uruz', gloss: 'u' },
    { char: 'ᚦ', roman: 'thurisaz', gloss: 'th' }, { char: 'ᚨ', roman: 'ansuz', gloss: 'a' },
    { char: 'ᚱ', roman: 'raidho', gloss: 'r' }, { char: 'ᚲ', roman: 'kaunan', gloss: 'k' },
    { char: 'ᚷ', roman: 'gyfu', gloss: 'g' }, { char: 'ᚹ', roman: 'wunjo', gloss: 'w' },
    { char: 'ᚺ', roman: 'hagalaz', gloss: 'h' }, { char: 'ᚾ', roman: 'naudiz', gloss: 'n' },
    { char: 'ᛁ', roman: 'isa', gloss: 'i' }, { char: 'ᛃ', roman: 'jera', gloss: 'j' },
    { char: 'ᛇ', roman: 'eihwaz', gloss: 'ei' }, { char: 'ᛈ', roman: 'pertho', gloss: 'p' },
    { char: 'ᛉ', roman: 'algiz', gloss: 'z' }, { char: 'ᛊ', roman: 'sowilo', gloss: 's' },
    { char: 'ᛏ', roman: 'tiwaz', gloss: 't' }, { char: 'ᛒ', roman: 'berkanan', gloss: 'b' },
    { char: 'ᛖ', roman: 'ehwaz', gloss: 'e' }, { char: 'ᛗ', roman: 'mannaz', gloss: 'm' },
    { char: 'ᛚ', roman: 'laguz', gloss: 'l' }, { char: 'ᛜ', roman: 'ingwaz', gloss: 'ng' },
    { char: 'ᛞ', roman: 'dagaz', gloss: 'd' }, { char: 'ᛟ', roman: 'othala', gloss: 'o' },
];

export const ANGLO_SAXON_FUTHORC = [
    { char: 'ᚠ', roman: 'feoh', gloss: 'f' }, { char: 'ᚢ', roman: 'ur', gloss: 'u' },
    { char: 'ᚦ', roman: 'thorn', gloss: 'th' }, { char: 'ᚩ', roman: 'os', gloss: 'o' },
    { char: 'ᚱ', roman: 'rad', gloss: 'r' }, { char: 'ᚳ', roman: 'cen', gloss: 'c' },
    { char: 'ᚷ', roman: 'gyfu', gloss: 'g' }, { char: 'ᚹ', roman: 'wynn', gloss: 'w' },
    { char: 'ᚻ', roman: 'haegl', gloss: 'h' }, { char: 'ᚾ', roman: 'nyd', gloss: 'n' },
    { char: 'ᛁ', roman: 'is', gloss: 'i' }, { char: 'ᛄ', roman: 'ger', gloss: 'j' },
    { char: 'ᛇ', roman: 'eoh', gloss: 'eo' }, { char: 'ᛈ', roman: 'peorth', gloss: 'p' },
    { char: 'ᛉ', roman: 'eolh', gloss: 'x' }, { char: 'ᛋ', roman: 'sigel', gloss: 's' },
    { char: 'ᛏ', roman: 'tir', gloss: 't' }, { char: 'ᛒ', roman: 'beorc', gloss: 'b' },
    { char: 'ᛖ', roman: 'eh', gloss: 'e' }, { char: 'ᛗ', roman: 'man', gloss: 'm' },
    { char: 'ᛚ', roman: 'lagu', gloss: 'l' }, { char: 'ᛝ', roman: 'ing', gloss: 'ng' },
    { char: 'ᛟ', roman: 'ethel', gloss: 'oe' }, { char: 'ᛞ', roman: 'daeg', gloss: 'd' },
    { char: 'ᚪ', roman: 'ac', gloss: 'a' }, { char: 'ᚫ', roman: 'aesc', gloss: 'ae' },
    { char: 'ᚣ', roman: 'yr', gloss: 'y' }, { char: 'ᛡ', roman: 'ior', gloss: 'ia' },
    { char: 'ᛠ', roman: 'ear', gloss: 'ea' }, { char: 'ᚬ', roman: 'ae', gloss: 'æ' },
    { char: 'ᚭ', roman: 'io', gloss: 'io' }, { char: 'ᚯ', roman: 'k', gloss: 'k' },
    { char: 'ᚰ', roman: 'calc', gloss: 'q' },
];

const KLINGON_LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
export const KLINGON_PIQAD = KLINGON_LETTERS.map((letter, i) => ({
    char: cp(0xF8D0 + i),
    roman: letter,
}));

const TENGWAR_CONSONANTS = [
    [0x16D00, 'tinco', 't'], [0x16D01, 'parma', 'p'], [0x16D02, 'calma', 'ch'], [0x16D03, 'quesse', 'k'],
    [0x16D04, 'ando', 'd'], [0x16D05, 'ungwe', 'ng'], [0x16D06, 'thule', 'th'], [0x16D07, 'formen', 'f'],
    [0x16D08, 'harma', 'sh'], [0x16D09, 'hwesta', 'hw'], [0x16D0A, 'anto', 'nt'], [0x16D0B, 'ampa', 'mp'],
    [0x16D0C, 'anca', 'nk'], [0x16D0D, 'anqua', 'nqu'], [0x16D0E, 'unque', 'ngw'], [0x16D0F, 'umbe', 'mb'],
    [0x16D10, 'malta', 'm'], [0x16D11, 'ngoldo', 'ng'], [0x16D12, 'noldo', 'nd'], [0x16D13, 'nwalme', 'nw'],
    [0x16D14, 'ngwalme', 'ngw'], [0x16D15, 'oore', 'oo'], [0x16D16, 'vala', 'v'], [0x16D17, 'anna', 'n'],
    [0x16D18, 'vilya', 'w'], [0x16D19, 'romen', 'r'], [0x16D1A, 'arda', 'rd'], [0x16D1B, 'lambe', 'l'],
    [0x16D1C, 'alda', 'ld'], [0x16D1D, 'silme', 's'], [0x16D1F, 'esse', 'ss'], [0x16D21, 'hya', 'hy'],
];

const TENGWAR_TEHTAR = [
    [0x16D38, 'a-tehta', 'a'], [0x16D39, 'e-tehta', 'e'], [0x16D3A, 'i-tehta', 'i'],
    [0x16D3B, 'o-tehta', 'o'], [0x16D3C, 'u-tehta', 'u'], [0x16D3D, 'y-tehta', 'y'],
];

function tengwarEntries(consonants, tehtar) {
    const cons = consonants.map(([code, name, gloss]) => ({
        char: cp(code),
        roman: name,
        gloss,
    }));
    const vows = tehtar.map(([code, name, gloss]) => ({
        char: cp(code),
        roman: name,
        gloss,
    }));
    return [...cons, ...vows];
}

export const TENGWAR_QUENYA = tengwarEntries(TENGWAR_CONSONANTS, TENGWAR_TEHTAR);

export const TENGWAR_SINDARIN = TENGWAR_CONSONANTS.map(([code, , gloss]) => ({
    char: cp(code),
    roman: gloss,
    gloss: 'Sindarin',
})).concat(TENGWAR_TEHTAR.map(([code, , gloss]) => ({
    char: cp(code),
    roman: gloss,
    gloss: 'vowel',
})));

export const TENGWAR_BLACK_SPEECH = [
    { char: cp(0x16D08), roman: 'ash', gloss: 'Ring · sh' },
    { char: cp(0x16D17), roman: 'nazg', gloss: 'Ring · n' },
    { char: cp(0x16D38), roman: 'a', gloss: 'vowel tehta' },
    { char: cp(0x16D1D), roman: 'z', gloss: 'Ring · z' },
    { char: cp(0x16D05), roman: 'g', gloss: 'Ring · g' },
    { char: cp(0x16D04), roman: 'durbatuluk', gloss: 'Ring · d' },
    { char: cp(0x16D3C), roman: 'u', gloss: 'vowel tehta' },
    { char: cp(0x16D19), roman: 'r', gloss: 'Ring · r' },
    { char: cp(0x16D02), roman: 'b', gloss: 'Ring · b' },
    { char: cp(0x16D00), roman: 't', gloss: 'Ring · t' },
    { char: cp(0x16D1B), roman: 'l', gloss: 'Ring · l' },
    { char: cp(0x16D03), roman: 'k', gloss: 'Ring · k' },
    { char: cp(0x16D06), roman: 'th', gloss: 'Black Speech' },
    { char: cp(0x16D07), roman: 'f', gloss: 'Black Speech' },
    { char: cp(0x16D10), roman: 'm', gloss: 'Black Speech' },
    { char: cp(0x16D3B), roman: 'o', gloss: 'vowel tehta' },
];

export const CIRTH_ANGERTHAS = [
    { char: cp(0x16D80), roman: 'p', gloss: 'p' }, { char: cp(0x16D81), roman: 'b', gloss: 'b' },
    { char: cp(0x16D82), roman: 'f', gloss: 'f' }, { char: cp(0x16D83), roman: 'v', gloss: 'v' },
    { char: cp(0x16D84), roman: 'th', gloss: 'th' }, { char: cp(0x16D85), roman: 'dh', gloss: 'dh' },
    { char: cp(0x16D86), roman: 'ch', gloss: 'ch' }, { char: cp(0x16D87), roman: 'j', gloss: 'j' },
    { char: cp(0x16D88), roman: 'sh', gloss: 'sh' }, { char: cp(0x16D89), roman: 'zh', gloss: 'zh' },
    { char: cp(0x16D8A), roman: 'ng', gloss: 'ng' }, { char: cp(0x16D8B), roman: 'k', gloss: 'k' },
    { char: cp(0x16D8C), roman: 'g', gloss: 'g' }, { char: cp(0x16D8D), roman: 'kh', gloss: 'kh' },
    { char: cp(0x16D8E), roman: 'gh', gloss: 'gh' }, { char: cp(0x16D8F), roman: 'n', gloss: 'n' },
    { char: cp(0x16D90), roman: 't', gloss: 't' }, { char: cp(0x16D91), roman: 'd', gloss: 'd' },
    { char: cp(0x16D92), roman: 'r', gloss: 'r' }, { char: cp(0x16D93), roman: 'l', gloss: 'l' },
    { char: cp(0x16D94), roman: 's', gloss: 's' }, { char: cp(0x16D95), roman: 'z', gloss: 'z' },
    { char: cp(0x16D96), roman: 'h', gloss: 'h' }, { char: cp(0x16D97), roman: 'hw', gloss: 'hw' },
    { char: cp(0x16D98), roman: 'm', gloss: 'm' }, { char: cp(0x16D99), roman: 'y', gloss: 'y' },
    { char: cp(0x16D9A), roman: 'w', gloss: 'w' }, { char: cp(0x16D9B), roman: 'a', gloss: 'a' },
    { char: cp(0x16D9C), roman: 'e', gloss: 'e' }, { char: cp(0x16D9D), roman: 'i', gloss: 'i' },
    { char: cp(0x16D9E), roman: 'o', gloss: 'o' }, { char: cp(0x16D9F), roman: 'u', gloss: 'u' },
    { char: cp(0x16DA0), roman: 'ae', gloss: 'ae' }, { char: cp(0x16DA1), roman: 'oe', gloss: 'oe' },
    { char: cp(0x16DA2), roman: 'ai', gloss: 'ai' }, { char: cp(0x16DA3), roman: 'ei', gloss: 'ei' },
    { char: cp(0x16DA4), roman: 'ui', gloss: 'ui' }, { char: cp(0x16DA5), roman: 'au', gloss: 'au' },
    { char: cp(0x16DA6), roman: 'iu', gloss: 'iu' }, { char: cp(0x16DA7), roman: 'oe', gloss: 'long oe' },
];

export const BRAILLE_CHARS = [
    { char: '⠁', roman: 'a' }, { char: '⠃', roman: 'b' }, { char: '⠉', roman: 'c' },
    { char: '⠙', roman: 'd' }, { char: '⠑', roman: 'e' }, { char: '⠋', roman: 'f' },
    { char: '⠛', roman: 'g' }, { char: '⠓', roman: 'h' }, { char: '⠊', roman: 'i' },
    { char: '⠚', roman: 'j' }, { char: '⠅', roman: 'k' }, { char: '⠇', roman: 'l' },
    { char: '⠍', roman: 'm' }, { char: '⠝', roman: 'n' }, { char: '⠕', roman: 'o' },
    { char: '⠏', roman: 'p' }, { char: '⠟', roman: 'q' }, { char: '⠗', roman: 'r' },
    { char: '⠎', roman: 's' }, { char: '⠞', roman: 't' }, { char: '⠥', roman: 'u' },
    { char: '⠧', roman: 'v' }, { char: '⠺', roman: 'w' }, { char: '⠭', roman: 'x' },
    { char: '⠽', roman: 'y' }, { char: '⠵', roman: 'z' },
    { char: '⠂', roman: ',' }, { char: '⠆', roman: ';' }, { char: '⠒', roman: ':' },
    { char: '⠲', roman: '.' }, { char: '⠦', roman: '?' }, { char: '⠖', roman: '!' },
    { char: '⠤', roman: '-' }, { char: '⠷', roman: '(' }, { char: '⠾', roman: ')' },
    { char: '⠼⠁', roman: '1' }, { char: '⠼⠃', roman: '2' }, { char: '⠼⠉', roman: '3' },
    { char: '⠼⠙', roman: '4' }, { char: '⠼⠑', roman: '5' }, { char: '⠼⠋', roman: '6' },
    { char: '⠼⠛', roman: '7' }, { char: '⠼⠓', roman: '8' }, { char: '⠼⠊', roman: '9' },
    { char: '⠼⠚', roman: '0' },
];

const IPA_SECTIONS = [
    {
        title: 'Vowels',
        chars: [
            { char: 'i', roman: 'ee' }, { char: 'y', roman: 'u (Fr)' }, { char: 'ɨ', roman: 'roses' },
            { char: 'ʉ', roman: 'close central' }, { char: 'ɯ', roman: 'close back unrounded' }, { char: 'u', roman: 'oo' },
            { char: 'ɪ', roman: 'kit' }, { char: 'ʏ', roman: 'hütte' }, { char: 'ʊ', roman: 'foot' },
            { char: 'e', roman: 'ay (without glide)' }, { char: 'ø', roman: 'eu (Fr)' }, { char: 'ɘ', roman: 'mid central' },
            { char: 'ɵ', roman: 'mid rounded' }, { char: 'ɤ', roman: 'close-mid back' }, { char: 'o', roman: 'o' },
            { char: 'ə', roman: 'schwa' }, { char: 'ɚ', roman: 'r-colored schwa' }, { char: 'ɛ', roman: 'bed' },
            { char: 'œ', roman: 'eu (open)' }, { char: 'ɜ', roman: 'bird' }, { char: 'ɞ', roman: 'open-mid rounded' },
            { char: 'ʌ', roman: 'strut' }, { char: 'ɔ', roman: 'thought' }, { char: 'æ', roman: 'trap' },
            { char: 'ɐ', roman: 'near-open central' }, { char: 'a', roman: 'father' }, { char: 'ɶ', roman: 'open front rounded' },
            { char: 'ɑ', roman: 'palm' }, { char: 'ɒ', roman: 'lot' },
        ],
    },
    {
        title: 'Pulmonic consonants',
        chars: [
            { char: 'p', roman: 'p', gloss: 'voiceless' }, { char: 'b', roman: 'b', gloss: 'voiced' },
            { char: 't', roman: 't', gloss: 'voiceless' }, { char: 'd', roman: 'd', gloss: 'voiced' },
            { char: 'ʈ', roman: 'rt', gloss: 'retroflex' }, { char: 'ɖ', roman: 'rd', gloss: 'voiced' },
            { char: 'c', roman: 'ty', gloss: 'palatal' }, { char: 'ɟ', roman: 'dy', gloss: 'voiced' },
            { char: 'k', roman: 'k', gloss: 'voiceless' }, { char: 'ɡ', roman: 'g', gloss: 'voiced' },
            { char: 'q', roman: 'uvular k' }, { char: 'ɢ', roman: 'voiced uvular' }, { char: 'ʔ', roman: 'glottal stop' },
            { char: 'm', roman: 'm' }, { char: 'ɱ', roman: 'labiodental m' }, { char: 'n', roman: 'n' },
            { char: 'ɳ', roman: 'retroflex n' }, { char: 'ɲ', roman: 'ny' }, { char: 'ŋ', roman: 'ng' }, { char: 'ɴ', roman: 'uvular n' },
            { char: 'ʙ', roman: 'bilabial trill' }, { char: 'r', roman: 'trill' }, { char: 'ʀ', roman: 'uvular trill' },
            { char: 'ⱱ', roman: 'labiodental flap' }, { char: 'ɾ', roman: 'flap' }, { char: 'ɽ', roman: 'retroflex flap' },
            { char: 'ɸ', roman: 'phi' }, { char: 'β', roman: 'beta' }, { char: 'f', roman: 'f' }, { char: 'v', roman: 'v' },
            { char: 'θ', roman: 'th (thin)' }, { char: 'ð', roman: 'th (this)' }, { char: 's', roman: 's' }, { char: 'z', roman: 'z' },
            { char: 'ʃ', roman: 'sh' }, { char: 'ʒ', roman: 'measure' }, { char: 'ʂ', roman: 'retroflex sh' }, { char: 'ʐ', roman: 'retroflex z' },
            { char: 'ç', roman: 'hue' }, { char: 'ʝ', roman: 'voiced hue' }, { char: 'x', roman: 'ch (Bach)' }, { char: 'ɣ', roman: 'voiced x' },
            { char: 'χ', roman: 'uvular fric' }, { char: 'ʁ', roman: 'voiced uvular' }, { char: 'ħ', roman: 'pharyngeal' }, { char: 'ʕ', roman: 'voiced pharyngeal' },
            { char: 'h', roman: 'h' }, { char: 'ɦ', roman: 'voiced h' },
            { char: 'ʋ', roman: 'v (between)' }, { char: 'ɹ', roman: 'r (English)' }, { char: 'ɻ', roman: 'retroflex approx' },
            { char: 'j', roman: 'y' }, { char: 'ɰ', roman: 'w (unrounded)' }, { char: 'ɥ', roman: 'hw' }, { char: 'ʍ', roman: 'wh' },
            { char: 'ɬ', roman: 'voiceless lateral' }, { char: 'ɮ', roman: 'voiced lateral' }, { char: 'ʎ', roman: 'll (million)' }, { char: 'ʟ', roman: 'velar lateral' },
        ],
    },
    {
        title: 'Non-pulmonic consonants',
        chars: [
            { char: 'ʘ', roman: 'bilabial click' }, { char: 'ǀ', roman: 'dental click' }, { char: 'ǃ', roman: 'alveolar click' },
            { char: 'ǂ', roman: 'palatal click' }, { char: 'ǁ', roman: 'lateral click' },
            { char: 'ɓ', roman: 'implosive b' }, { char: 'ɗ', roman: 'implosive d' }, { char: 'ʄ', roman: 'implosive j' },
            { char: 'ɠ', roman: 'implosive g' }, { char: 'ʛ', roman: 'implosive G' },
            { char: 'pʼ', roman: 'ejective p' }, { char: 'tʼ', roman: 'ejective t' }, { char: 'kʼ', roman: 'ejective k' },
            { char: 'sʼ', roman: 'ejective s' }, { char: 'tsʼ', roman: 'ejective ts' },
        ],
    },
    {
        title: 'Suprasegmentals',
        chars: [
            { char: 'ˈ', roman: 'primary stress' }, { char: 'ˌ', roman: 'secondary stress' }, { char: 'ː', roman: 'long' },
            { char: 'ˑ', roman: 'half-long' }, { char: '.', roman: 'syllable break' }, { char: '|', roman: 'minor break' },
            { char: '‖', roman: 'major break' }, { char: '‿', roman: 'linking' }, { char: '↗', roman: 'global rise' }, { char: '↘', roman: 'global fall' },
        ],
    },
    {
        title: 'Diacritics & modifiers',
        chars: [
            { char: 'ʰ', roman: 'aspirated' }, { char: 'ʷ', roman: 'labialized' }, { char: 'ʲ', roman: 'palatalized' },
            { char: 'ˠ', roman: 'velarized' }, { char: 'ˤ', roman: 'pharyngealized' }, { char: '̃', roman: 'nasalized' },
            { char: '̋', roman: 'extra high tone' }, { char: '́', roman: 'high tone' }, { char: '̀', roman: 'low tone' },
            { char: '̏', roman: 'extra low tone' }, { char: '̄', roman: 'mid tone' }, { char: '̌', roman: 'rising tone' },
            { char: '̂', roman: 'falling tone' }, { char: '̥', roman: 'voiceless' }, { char: '̬', roman: 'voiced' },
            { char: '̪', roman: 'dental' }, { char: '̺', roman: 'apical' }, { char: '̻', roman: 'laminal' },
            { char: '̼', roman: 'linguolabial' }, { char: '̰', roman: 'creaky' }, { char: '̤', roman: 'breathy' },
            { char: '̩', roman: 'syllabic' }, { char: '̯', roman: 'non-syllabic' }, { char: '̽', roman: 'mid-centralized' },
        ],
    },
    {
        title: 'Other symbols',
        chars: [
            { char: 'ʔ', roman: 'glottal stop' }, { char: 'ʕ', roman: 'pharyngeal fric' }, { char: 'ʡ', roman: 'epiglottal plosive' },
            { char: 'ʢ', roman: 'voiced epiglottal' }, { char: 'ʜ', roman: 'breathy h' }, { char: 'ʢ', roman: 'epiglottal' },
            { char: 'ɧ', roman: 'sj-sound' }, { char: 'ʩ', roman: 'feng' }, { char: 'ʪ', roman: 'lezh' }, { char: 'ʫ', roman: 'voiced lezh' },
            { char: 'ɺ', roman: 'alveolar lateral flap' }, { char: 'ɽ', roman: 'retroflex tap' }, { char: 'ʈ', roman: 'retroflex t' },
            { char: 'ɭ', roman: 'retroflex l' }, { char: 'ɮ', roman: 'zl' }, { char: 'ʎ', roman: 'ly' },
            { char: 'β', roman: 'b (fric)' }, { char: 'θ', roman: 'th' }, { char: 'ð', roman: 'th (voiced)' },
            { char: 'ŋ', roman: 'ng' }, { char: 'χ', roman: 'x (uvular)' }, { char: 'ʁ', roman: 'r (uvular)' },
        ],
    },
];

export const ALPHABETS_EXT = [
    {
        id: 'thai',
        title: 'Thai',
        subtitle: '44 consonants · common vowel marks',
        fontFamily: "'Leelawadee UI', 'Tahoma', sans-serif",
        layout: 'sections',
        sections: [
            { title: 'Consonants', chars: THAI_CONSONANTS },
            { title: 'Vowels', chars: THAI_VOWELS },
        ],
    },
    {
        id: 'tamil',
        title: 'Tamil',
        subtitle: 'Vowels & consonants',
        fontFamily: "'Nirmala UI', 'Latha', 'Segoe UI', sans-serif",
        layout: 'grid',
        chars: [
            { char: 'அ', roman: 'a' }, { char: 'ஆ', roman: 'aa' }, { char: 'இ', roman: 'i' }, { char: 'ஈ', roman: 'ii' },
            { char: 'உ', roman: 'u' }, { char: 'ஊ', roman: 'uu' }, { char: 'எ', roman: 'e' }, { char: 'ஏ', roman: 'ee' },
            { char: 'ஐ', roman: 'ai' }, { char: 'ஒ', roman: 'o' }, { char: 'ஓ', roman: 'oo' }, { char: 'ஔ', roman: 'au' },
            { char: 'க', roman: 'k' }, { char: 'ங', roman: 'ng' }, { char: 'ச', roman: 'c' }, { char: 'ஞ', roman: 'nj' },
            { char: 'ட', roman: 't' }, { char: 'ண', roman: 'n' }, { char: 'த', roman: 'th' }, { char: 'ந', roman: 'n' },
            { char: 'ப', roman: 'p' }, { char: 'ம', roman: 'm' }, { char: 'ய', roman: 'y' }, { char: 'ர', roman: 'r' },
            { char: 'ல', roman: 'l' }, { char: 'வ', roman: 'v' }, { char: 'ழ', roman: 'zh' }, { char: 'ள', roman: 'l' },
            { char: 'ற', roman: 'r' }, { char: 'ன', roman: 'n' },
        ],
    },
    {
        id: 'phoenician',
        title: 'Phoenician',
        subtitle: '22 letters',
        fontFamily: "'Segoe UI Historic', 'Noto Sans Phoenician', sans-serif",
        layout: 'grid',
        chars: [
            { char: '𐤀', roman: 'aleph' }, { char: '𐤁', roman: 'bet' }, { char: '𐤂', roman: 'gimel' }, { char: '𐤃', roman: 'dalet' },
            { char: '𐤄', roman: 'he' }, { char: '𐤅', roman: 'waw' }, { char: '𐤆', roman: 'zayin' }, { char: '𐤇', roman: 'het' },
            { char: '𐤈', roman: 'tet' }, { char: '𐤉', roman: 'yod' }, { char: '𐤊', roman: 'kaf' }, { char: '𐤋', roman: 'lamed' },
            { char: '𐤌', roman: 'mem' }, { char: '𐤍', roman: 'nun' }, { char: '𐤎', roman: 'samekh' }, { char: '𐤏', roman: 'ayin' },
            { char: '𐤐', roman: 'pe' }, { char: '𐤑', roman: 'tsadi' }, { char: '𐤒', roman: 'qof' }, { char: '𐤓', roman: 'resh' },
            { char: '𐤔', roman: 'shin' }, { char: '𐤕', roman: 'taw' },
        ],
    },
    {
        id: 'hieroglyphs',
        title: 'Hieroglyphs',
        subtitle: '100 common signs · transliteration & meaning',
        fontFamily: "'Segoe UI Historic', 'Noto Sans Egyptian Hieroglyphs', sans-serif",
        layout: 'grid',
        gridClass: 'hieroglyph',
        chars: HIEROGLYPHS_100,
    },
    {
        id: 'ipa',
        title: 'IPA',
        subtitle: 'International Phonetic Alphabet · full chart',
        fontFamily: "'Segoe UI', 'Charis SIL', 'Doulos SIL', serif",
        layout: 'sections',
        gridClass: 'ipa',
        sections: IPA_SECTIONS,
    },
    {
        id: 'braille',
        title: 'Braille',
        subtitle: 'Letters, digits & punctuation',
        fontFamily: "'Segoe UI', sans-serif",
        layout: 'grid',
        chars: BRAILLE_CHARS,
    },
    {
        id: 'morse',
        title: 'Morse',
        subtitle: 'A–Z & 0–9',
        fontFamily: "inherit",
        layout: 'grid',
        gridClass: 'morse',
        chars: MORSE_CODES,
    },
    {
        id: 'nato',
        title: 'NATO',
        subtitle: 'ICAO phonetic alphabet',
        fontFamily: "inherit",
        layout: 'grid',
        chars: NATO_WORDS,
    },
    {
        id: 'elder-futhark',
        title: 'Elder Futhark',
        subtitle: '24 runes · early Germanic & Nordic',
        fontFamily: "'Segoe UI Historic', 'Noto Sans Runic', sans-serif",
        layout: 'grid',
        chars: ELDER_FUTHARK,
    },
    {
        id: 'anglo-saxon',
        title: 'Anglo-Saxon',
        subtitle: '33 runes · Anglo-Frisian futhorc',
        fontFamily: "'Segoe UI Historic', 'Noto Sans Runic', sans-serif",
        layout: 'grid',
        chars: ANGLO_SAXON_FUTHORC,
    },
    {
        id: 'klingon',
        title: 'Klingon',
        subtitle: 'pIqaD · 26 letters',
        fontFamily: "'Klingon pIqaD', 'Code2001', sans-serif",
        layout: 'grid',
        chars: KLINGON_PIQAD,
    },
    {
        id: 'tengwar',
        title: 'Tengwar',
        subtitle: 'Elvish script · Quenya, Sindarin & Black Speech',
        fontFamily: "'Tengwar Telcontar', 'Code2001', serif",
        layout: 'sections',
        sections: [
            { title: 'Quenya', chars: TENGWAR_QUENYA },
            { title: 'Sindarin', chars: TENGWAR_SINDARIN },
            { title: 'Black Speech', chars: TENGWAR_BLACK_SPEECH },
        ],
    },
    {
        id: 'cirth',
        title: 'Cirth',
        subtitle: 'Angerthas · Dwarvish runes',
        fontFamily: "'Cirth Erebor', 'Code2001', serif",
        layout: 'grid',
        chars: CIRTH_ANGERTHAS,
    },
];
