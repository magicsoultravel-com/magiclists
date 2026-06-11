/** View metadata for the Cosmos tool. */

export const COSMOS_VIEWS = [
    {
        id: 'sky-north',
        label: 'Sky N',
        type: 'image',
        title: 'Northern sky',
        caption: 'Constellation map of the northern celestial hemisphere.',
        credit: 'Wikimedia Commons · Roberto Mura',
        src: './assets/cosmos/sky-north.png',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:North_Hemisphere.png'
    },
    {
        id: 'sky-south',
        label: 'Sky S',
        type: 'image',
        title: 'Southern sky',
        caption: 'Constellation map of the southern celestial hemisphere.',
        credit: 'Wikimedia Commons · Roberto Mura',
        src: './assets/cosmos/sky-south.png',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:South_Hemisphere.png'
    },
    {
        id: 'solar-system',
        label: 'Solar system',
        type: 'image',
        title: 'Solar system',
        caption: 'The Sun and major planets of the solar system.',
        credit: 'Wikimedia Commons',
        src: './assets/cosmos/solar-system.png',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:The_Solar_System.svg'
    },
    {
        id: 'nearby',
        label: 'Nearby',
        type: 'image',
        title: 'Milky Way galaxy',
        caption: 'Our home galaxy — the Sun lies in one of its spiral arms.',
        credit: 'NASA/JPL-Caltech · Wikimedia Commons',
        src: './assets/cosmos/milky-way.jpg',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Our_best_map_of_the_Milky_Way_so_far_(the-milky-way-galaxy).jpg'
    },
    {
        id: 'deep',
        label: 'Deep',
        type: 'image',
        title: 'Hubble Ultra Deep Field',
        caption: 'Thousands of galaxies in a narrow patch of sky — a glimpse of the distant universe.',
        credit: 'NASA · ESA · Hubble · Wikimedia Commons',
        src: './assets/cosmos/hubble-udf.jpg',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Hubble_ultra_deep_field.jpg',
        markers: [
            { id: 'earth', x: 0.5, y: 0.97, label: 'Earth', distance: 'Observer', role: 'observer' },
            { id: 'near', x: 0.28, y: 0.42, label: 'Nearby galaxy', distance: '~1 billion ly' },
            { id: 'mid', x: 0.62, y: 0.55, label: 'Distant galaxy', distance: '~5 billion ly' },
            { id: 'far', x: 0.78, y: 0.31, label: 'Early universe', distance: '~13 billion ly' }
        ]
    }
];
