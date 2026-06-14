/** Synop station id → coordinates for nearest-station lookup (IMGW id_stacji). */
export const SYNOP_STATIONS = {
    '12295': { lat: 54.3778, lon: 18.4667, name: 'Gdańsk-Rębiechowo' },
    '12300': { lat: 54.5539, lon: 18.5178, name: 'Hel' },
    '12345': { lat: 53.1078, lon: 17.9778, name: 'Bydgoszcz' },
    '12360': { lat: 52.1389, lon: 21.0453, name: 'Warszawa-Bielany' },
    '12375': { lat: 52.1657, lon: 20.9671, name: 'Warszawa-Okęcie' },
    '12405': { lat: 51.9333, lon: 15.5333, name: 'Zielona Góra' },
    '12415': { lat: 51.4025, lon: 21.1472, name: 'Radom' },
    '12418': { lat: 51.7219, lon: 19.3981, name: 'Łódź-Lublinek' },
    '12424': { lat: 51.1047, lon: 17.1764, name: 'Wrocław-Strachowice' },
    '12435': { lat: 50.8125, lon: 19.0889, name: 'Katowice-Pyrzowice' },
    '12465': { lat: 50.0786, lon: 19.7847, name: 'Kraków-Balice' },
    '12488': { lat: 49.7833, lon: 22.7833, name: 'Przemyśl' },
    '12530': { lat: 49.8139, lon: 19.0019, name: 'Zakopane' },
    '12560': { lat: 50.0378, lon: 22.0194, name: 'Rzeszów-Jasionka' },
    '12566': { lat: 49.8042, lon: 22.3375, name: 'Krosno' },
    '12580': { lat: 50.4744, lon: 20.7258, name: 'Kielce' },
    '12600': { lat: 52.2319, lon: 21.0056, name: 'Warszawa-Rembertów' },
    '12605': { lat: 52.5903, lon: 19.7319, name: 'Płock' },
    '12625': { lat: 53.1072, lon: 23.1139, name: 'Białystok' },
    '12650': { lat: 53.7778, lon: 20.4944, name: 'Olsztyn' },
    '12670': { lat: 54.1219, lon: 15.7986, name: 'Kołobrzeg' },
    '12695': { lat: 53.3956, lon: 14.9019, name: 'Szczecin-Goleniów' },
    '12745': { lat: 51.9356, lon: 22.3853, name: 'Siedlce' },
    '12760': { lat: 52.5928, lon: 14.6572, name: 'Gorzów Wielkopolski' },
    '12772': { lat: 52.4086, lon: 16.8122, name: 'Poznań-Ławica' },
    '12785': { lat: 52.6519, lon: 19.7319, name: 'Włocławek' },
    '12825': { lat: 50.2856, lon: 18.9786, name: 'Opole' },
    '12860': { lat: 50.8125, lon: 19.0889, name: 'Częstochowa' },
    '12879': { lat: 50.4744, lon: 20.7258, name: 'Sandomierz' },
    '12925': { lat: 51.5500, lon: 23.5500, name: 'Włodawa' },
    '12970': { lat: 53.5847, lon: 14.9006, name: 'Świnoujście' }
};

export function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findNearestStation(lat, lon) {
    let best = null;
    let bestDist = Infinity;
    for (const [id, station] of Object.entries(SYNOP_STATIONS)) {
        const dist = haversineKm(lat, lon, station.lat, station.lon);
        if (dist < bestDist) {
            bestDist = dist;
            best = { id, ...station, distanceKm: dist };
        }
    }
    return best;
}
