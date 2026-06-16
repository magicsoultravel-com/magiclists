/** Unicode emoji catalog for note insertion. */

const REGION_NAMES = typeof Intl !== 'undefined' && Intl.DisplayNames
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

const FLAG_ISO_CODES = (
    'AC AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT '
    + 'BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CP CR CU CV CW CX CY CZ DE DG DJ DK DM DO DZ EA EC EE '
    + 'EG EH ER ES ET EU FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN '
    + 'HR HT HU IC ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK '
    + 'LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG '
    + 'NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG '
    + 'SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TA TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG '
    + 'UM UN US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
).trim().split(/\s+/);

export function flagFromIso(iso2) {
    const code = String(iso2 || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return '';
    return [...code].map((ch) => String.fromCodePoint(0x1F1E6 - 65 + ch.charCodeAt(0))).join('');
}

function countryLabel(iso) {
    const name = REGION_NAMES?.of(iso);
    if (name && name !== iso) return name;
    return iso;
}

function buildFlagEmojis() {
    return FLAG_ISO_CODES
        .map((iso) => ({
            char: flagFromIso(iso),
            label: countryLabel(iso)
        }))
        .filter((entry) => entry.char)
        .sort((a, b) => a.label.localeCompare(b.label, 'en'));
}

const SMILEYS = [
    ['😀', 'Grinning'], ['😃', 'Grinning big eyes'], ['😄', 'Grinning smiling eyes'], ['😁', 'Beaming'],
    ['😆', 'Squinting'], ['😅', 'Sweat smile'], ['🤣', 'Rolling on floor'], ['😂', 'Joy tears'],
    ['🙂', 'Slight smile'], ['🙃', 'Upside-down'], ['😉', 'Wink'], ['😊', 'Smiling eyes'],
    ['😇', 'Halo'], ['🥰', 'Smiling hearts'], ['😍', 'Heart eyes'], ['🤩', 'Star-struck'],
    ['😘', 'Kiss'], ['😋', 'Yum'], ['😛', 'Tongue'], ['🥲', 'Smiling tear'],
    ['😢', 'Cry'], ['😭', 'Loud cry'], ['😤', 'Steam'], ['😡', 'Angry'],
    ['🥳', 'Party'], ['😎', 'Sunglasses'], ['🤔', 'Thinking'], ['😴', 'Sleeping'],
    ['😮', 'Open mouth'], ['🥺', 'Pleading'], ['😐', 'Neutral'], ['😏', 'Smirk']
].map(([char, label]) => ({ char, label }));

const GESTURES = [
    ['👍', 'Thumbs up'], ['👎', 'Thumbs down'], ['👌', 'OK'], ['✌️', 'Victory'],
    ['🤞', 'Crossed fingers'], ['🤙', 'Call me'], ['👏', 'Clap'], ['🙌', 'Raised hands'],
    ['🙏', 'Folded hands'], ['💪', 'Flexed bicep'], ['🤝', 'Handshake'], ['👋', 'Wave'],
    ['🤷', 'Shrug'], ['🤦', 'Facepalm'], ['🫡', 'Salute'], ['🫶', 'Heart hands'],
    ['✋', 'Raised hand'], ['🤚', 'Raised back of hand'], ['👊', 'Fist bump']
].map(([char, label]) => ({ char, label }));

const SYMBOLS = [
    ['❤️', 'Red heart'], ['🧡', 'Orange heart'], ['💛', 'Yellow heart'], ['💚', 'Green heart'],
    ['💙', 'Blue heart'], ['💜', 'Purple heart'], ['🖤', 'Black heart'], ['🤍', 'White heart'],
    ['💔', 'Broken heart'], ['⭐', 'Star'], ['✨', 'Sparkles'], ['✅', 'Check mark'],
    ['❌', 'Cross mark'], ['⚠️', 'Warning'], ['🔥', 'Fire'], ['💡', 'Light bulb'],
    ['📌', 'Pin'], ['🎯', 'Target'], ['🔔', 'Bell'], ['💯', 'Hundred'],
    ['🎉', 'Party popper'], ['🎊', 'Confetti']
].map(([char, label]) => ({ char, label }));

const VEHICLES = [
    ['🚗', 'Car'], ['🚕', 'Taxi'], ['🚙', 'SUV'], ['🚌', 'Bus'], ['🚎', 'Trolleybus'],
    ['🏎️', 'Race car'], ['🚓', 'Police car'], ['🚑', 'Ambulance'], ['🚒', 'Fire engine'],
    ['🚐', 'Minibus'], ['🛻', 'Pickup'], ['🚚', 'Delivery truck'], ['🚛', 'Articulated lorry'],
    ['🚜', 'Tractor'], ['🏍️', 'Motorcycle'], ['🛵', 'Scooter'], ['🚲', 'Bicycle'],
    ['✈️', 'Airplane'], ['🛫', 'Departure'], ['🛬', 'Arrival'], ['🚀', 'Rocket'],
    ['🛸', 'Flying saucer'], ['🚁', 'Helicopter'], ['⛵', 'Sailboat'], ['🚤', 'Speedboat'],
    ['🛳️', 'Passenger ship'], ['🚂', 'Locomotive'], ['🚆', 'Train'], ['🚇', 'Metro'],
    ['🚊', 'Tram']
].map(([char, label]) => ({ char, label }));

const NATURE = [
    ['🐶', 'Dog'], ['🐱', 'Cat'], ['🐭', 'Mouse'], ['🐹', 'Hamster'], ['🐰', 'Rabbit'],
    ['🦊', 'Fox'], ['🐻', 'Bear'], ['🐼', 'Panda'], ['🐨', 'Koala'], ['🐯', 'Tiger'],
    ['🦁', 'Lion'], ['🐮', 'Cow'], ['🐷', 'Pig'], ['🐸', 'Frog'], ['🐵', 'Monkey'],
    ['🌸', 'Cherry blossom'], ['🌻', 'Sunflower'], ['🌲', 'Evergreen'], ['🌴', 'Palm tree'],
    ['🍀', 'Four leaf clover'], ['🌈', 'Rainbow'], ['☀️', 'Sun'], ['🌙', 'Moon'],
    ['⭐', 'Star'], ['🌊', 'Wave'], ['🔥', 'Fire']
].map(([char, label]) => ({ char, label }));

export const EMOJI_TABS = [
    { id: 'smileys', label: 'Smileys', emojis: SMILEYS },
    { id: 'gestures', label: 'Gestures', emojis: GESTURES },
    { id: 'symbols', label: 'Symbols', emojis: SYMBOLS },
    { id: 'flags', label: 'Flags', emojis: buildFlagEmojis() },
    { id: 'vehicles', label: 'Vehicles', emojis: VEHICLES },
    { id: 'nature', label: 'Nature', emojis: NATURE }
];

export const EMOJI_TAB_BY_ID = Object.fromEntries(EMOJI_TABS.map((tab) => [tab.id, tab]));

const ALLOWED_EMOJI = new Set(EMOJI_TABS.flatMap((tab) => tab.emojis.map((e) => e.char)));

export function getEmojiTab(id = 'smileys') {
    return EMOJI_TAB_BY_ID[id] || EMOJI_TABS[0];
}

export function isAllowedEmoji(char) {
    return ALLOWED_EMOJI.has(char);
}
