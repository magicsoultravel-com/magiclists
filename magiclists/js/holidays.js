// Static holiday data per country
// Format: { month: 0-11, day: 1-31, name: string, floating?: function }
// Floating holidays are calculated dynamically

const holidayData = {
    US: {
        name: "United States",
        holidays: [
            { month: 0, day: 1, name: "New Year's Day" },
            { month: 0, day: 20, name: "Martin Luther King Jr. Day", floating: (year) => getNthWeekday(year, 0, 1, 3) }, // 3rd Monday of Jan
            { month: 1, day: 14, name: "Valentine's Day" },
            { month: 1, day: 19, name: "Presidents' Day", floating: (year) => getNthWeekday(year, 1, 1, 3) }, // 3rd Monday of Feb
            { month: 4, day: 26, name: "Memorial Day", floating: (year) => getLastWeekday(year, 4, 1) }, // Last Monday of May
            { month: 6, day: 4, name: "Independence Day" },
            { month: 8, day: 1, name: "Labor Day", floating: (year) => getNthWeekday(year, 8, 1, 1) }, // 1st Monday of Sep
            { month: 9, day: 8, name: "Columbus Day", floating: (year) => getNthWeekday(year, 9, 1, 2) }, // 2nd Monday of Oct
            { month: 10, day: 11, name: "Veterans Day" },
            { month: 10, day: 22, name: "Thanksgiving", floating: (year) => getNthWeekday(year, 10, 4, 4) }, // 4th Thursday of Nov
            { month: 11, day: 25, name: "Christmas Day" }
        ]
    },
    CA: {
        name: "Canada",
        holidays: [
            { month: 0, day: 1, name: "New Year's Day" },
            { month: 1, day: 15, name: "Family Day", floating: (year) => getNthWeekday(year, 1, 1, 3) }, // 3rd Monday of Feb
            { month: 3, day: 18, name: "Good Friday", floating: (year) => getEaster(year, -2) },
            { month: 4, day: 20, name: "Victoria Day", floating: (year) => getMondayBeforeMay24(year) },
            { month: 6, day: 1, name: "Canada Day" },
            { month: 8, day: 1, name: "Labour Day", floating: (year) => getNthWeekday(year, 8, 1, 1) }, // 1st Monday of Sep
            { month: 9, day: 8, name: "Thanksgiving", floating: (year) => getNthWeekday(year, 9, 1, 2) }, // 2nd Monday of Oct
            { month: 10, day: 11, name: "Remembrance Day" },
            { month: 11, day: 25, name: "Christmas Day" },
            { month: 11, day: 26, name: "Boxing Day" }
        ]
    },
    FR: {
        name: "France",
        holidays: [
            { month: 0, day: 1, name: "New Year's Day" },
            { month: 3, day: 18, name: "Easter Monday", floating: (year) => getEaster(year, 1) },
            { month: 4, day: 1, name: "Labour Day" },
            { month: 4, day: 8, name: "Victory in Europe Day" },
            { month: 4, day: 28, name: "Ascension Day", floating: (year) => getEaster(year, 39) },
            { month: 5, day: 8, name: "Whit Monday", floating: (year) => getEaster(year, 50) },
            { month: 6, day: 14, name: "Bastille Day" },
            { month: 7, day: 15, name: "Assumption of Mary" },
            { month: 10, day: 1, name: "All Saints' Day" },
            { month: 10, day: 11, name: "Armistice Day" },
            { month: 11, day: 25, name: "Christmas Day" }
        ]
    },
    PL: {
        name: "Poland",
        holidays: [
            { month: 0, day: 1, name: "New Year's Day" },
            { month: 0, day: 6, name: "Epiphany" },
            { month: 3, day: 18, name: "Easter Sunday", floating: (year) => getEaster(year, 0) },
            { month: 3, day: 19, name: "Easter Monday", floating: (year) => getEaster(year, 1) },
            { month: 4, day: 1, name: "Labour Day" },
            { month: 4, day: 3, name: "Constitution Day" },
            { month: 5, day: 8, name: "Pentecost Sunday", floating: (year) => getEaster(year, 49) },
            { month: 5, day: 19, name: "Corpus Christi", floating: (year) => getEaster(year, 60) },
            { month: 7, day: 15, name: "Assumption of Mary" },
            { month: 10, day: 1, name: "All Saints' Day" },
            { month: 10, day: 11, name: "Independence Day" },
            { month: 11, day: 25, name: "Christmas Day" },
            { month: 11, day: 26, name: "Boxing Day" }
        ]
    },
    IN: {
        name: "India",
        holidays: [
            { month: 0, day: 26, name: "Republic Day" },
            { month: 2, day: 25, name: "Holi", floating: (year) => getHoliDate(year) },
            { month: 7, day: 15, name: "Independence Day" },
            { month: 9, day: 2, name: "Gandhi Jayanti" },
            { month: 10, day: 12, name: "Diwali", floating: (year) => getDiwaliDate(year) },
            { month: 11, day: 25, name: "Christmas Day" }
        ]
    },
    CN: {
        name: "China",
        holidays: [
            { month: 0, day: 1, name: "New Year's Day" },
            { month: 0, day: 28, name: "Spring Festival (Lunar New Year)", floating: (year) => getChineseNewYear(year) },
            { month: 3, day: 5, name: "Qingming Festival", floating: (year) => getQingming(year) },
            { month: 4, day: 1, name: "Labour Day" },
            { month: 5, day: 10, name: "Dragon Boat Festival", floating: (year) => getDragonBoat(year) },
            { month: 8, day: 15, name: "Mid-Autumn Festival", floating: (year) => getMidAutumn(year) },
            { month: 9, day: 1, name: "National Day" }
        ]
    },
    DE: {
        name: "Germany",
        holidays: [
            { month: 0, day: 1, name: "New Year's Day" },
            { month: 3, day: 18, name: "Good Friday", floating: (year) => getEaster(year, -2) },
            { month: 3, day: 21, name: "Easter Monday", floating: (year) => getEaster(year, 1) },
            { month: 4, day: 1, name: "Labour Day" },
            { month: 4, day: 28, name: "Ascension Day", floating: (year) => getEaster(year, 39) },
            { month: 5, day: 8, name: "Whit Monday", floating: (year) => getEaster(year, 50) },
            { month: 9, day: 3, name: "German Unity Day" },
            { month: 11, day: 25, name: "Christmas Day" },
            { month: 11, day: 26, name: "Boxing Day" }
        ]
    },
    GB: {
        name: "United Kingdom",
        holidays: [
            { month: 0, day: 1, name: "New Year's Day" },
            { month: 3, day: 18, name: "Good Friday", floating: (year) => getEaster(year, -2) },
            { month: 3, day: 21, name: "Easter Monday", floating: (year) => getEaster(year, 1) },
            { month: 4, day: 1, name: "Early May Bank Holiday", floating: (year) => getNthWeekday(year, 4, 1, 1) }, // 1st Monday of May
            { month: 4, day: 29, name: "Spring Bank Holiday", floating: (year) => getLastWeekday(year, 4, 1) }, // Last Monday of May
            { month: 7, day: 28, name: "Summer Bank Holiday", floating: (year) => getLastWeekday(year, 7, 1) }, // Last Monday of Aug
            { month: 11, day: 25, name: "Christmas Day" },
            { month: 11, day: 26, name: "Boxing Day" }
        ]
    },
    JP: {
        name: "Japan",
        holidays: [
            { month: 0, day: 1, name: "New Year's Day" },
            { month: 0, day: 9, name: "Coming of Age Day", floating: (year) => getNthWeekday(year, 0, 1, 2) }, // 2nd Monday of Jan
            { month: 1, day: 11, name: "National Foundation Day" },
            { month: 2, day: 20, name: "Vernal Equinox", floating: (year) => getEquinox(year, true) },
            { month: 3, day: 29, name: "Showa Day" },
            { month: 4, day: 3, name: "Constitution Memorial Day" },
            { month: 4, day: 4, name: "Greenery Day" },
            { month: 4, day: 5, name: "Children's Day" },
            { month: 6, day: 15, name: "Marine Day", floating: (year) => getNthWeekday(year, 6, 1, 3) }, // 3rd Monday of Jul
            { month: 7, day: 11, name: "Mountain Day", floating: (year) => getNthWeekday(year, 7, 1, 3) }, // 3rd Monday of Aug
            { month: 8, day: 15, name: "Respect for the Aged Day", floating: (year) => getNthWeekday(year, 8, 1, 3) }, // 3rd Monday of Sep
            { month: 8, day: 22, name: "Autumnal Equinox", floating: (year) => getEquinox(year, false) },
            { month: 9, day: 9, name: "Health and Sports Day", floating: (year) => getNthWeekday(year, 9, 1, 2) }, // 2nd Monday of Oct
            { month: 10, day: 3, name: "Culture Day" },
            { month: 10, day: 23, name: "Labor Thanksgiving Day" },
            { month: 11, day: 23, name: "Emperor's Birthday" }
        ]
    }
};

// Helper: Get date of nth weekday in month (0=Sunday, 1=Monday, etc.)
function getNthWeekday(year, month, weekday, nth) {
    const date = new Date(year, month, 1);
    let count = 0;
    while (date.getMonth() === month) {
        if (date.getDay() === weekday) {
            count++;
            if (count === nth) return new Date(date);
        }
        date.setDate(date.getDate() + 1);
    }
    return null;
}

// Helper: Get last weekday of month (0=Sunday)
function getLastWeekday(year, month, weekday) {
    const date = new Date(year, month + 1, 0);
    while (date.getDay() !== weekday) {
        date.setDate(date.getDate() - 1);
    }
    return new Date(date);
}

// Helper: Get date for Good Friday, Easter Monday, etc.
function getEaster(year, offsetDays) {
    // Computus algorithm for Easter Sunday
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    const easter = new Date(year, month - 1, day);
    easter.setDate(easter.getDate() + offsetDays);
    return easter;
}

// Canada: Monday before May 24
function getMondayBeforeMay24(year) {
    const may24 = new Date(year, 4, 24);
    const dayOfWeek = may24.getDay();
    const daysToMonday = (dayOfWeek === 1) ? 0 : (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
    may24.setDate(may24.getDate() - daysToMonday);
    return may24;
}

// India: Holi (full moon day of Phalguna month - approximate)
function getHoliDate(year) {
    const date = new Date(year, 2, 14);
    const daysToFullMoon = (15 - date.getDate()) % 15;
    date.setDate(date.getDate() + daysToFullMoon);
    return date;
}

// India: Diwali (15th day of Kartik month - approximate)
function getDiwaliDate(year) {
    const date = new Date(year, 9, 28);
    const daysToNewMoon = (30 - date.getDate()) % 30;
    date.setDate(date.getDate() + daysToNewMoon);
    return date;
}

// China: Chinese New Year (simplified - between Jan 21 and Feb 20)
function getChineseNewYear(year) {
    const date = new Date(year, 0, 28);
    date.setDate(date.getDate() + (year % 12) * 2);
    return date;
}

function getQingming(year) {
    return new Date(year, 3, 4);
}

function getDragonBoat(year) {
    return new Date(year, 5, 12);
}

function getMidAutumn(year) {
    return new Date(year, 8, 18);
}

// Japan: Equinoxes
function getEquinox(year, isVernal) {
    if (isVernal) {
        return new Date(year, 2, 20);
    } else {
        return new Date(year, 8, 22);
    }
}

// Main export
export const Holidays = {
    currentCountry: "US",
    countries: {
        US: "United States",
        CA: "Canada",
        FR: "France",
        PL: "Poland",
        IN: "India",
        CN: "China",
        DE: "Germany",
        GB: "United Kingdom",
        JP: "Japan"
    },
    
    setCountry(countryCode) {
        if (holidayData[countryCode]) {
            this.currentCountry = countryCode;
            localStorage.setItem('calendar_holiday_country', countryCode);
            return true;
        }
        return false;
    },
    
    getCountry() {
        return localStorage.getItem('calendar_holiday_country') || 'US';
    },
    
    isHoliday(date) {
        const countryCode = this.getCountry();
        const countryHolidays = holidayData[countryCode];
        if (!countryHolidays) return null;
        
        const year = date.getFullYear();
        const month = date.getMonth();
        const day = date.getDate();
        
        for (const h of countryHolidays.holidays) {
            let holidayDate;
            if (h.floating) {
                holidayDate = h.floating(year);
                if (holidayDate && holidayDate.getMonth() === month && holidayDate.getDate() === day) {
                    return h.name;
                }
            } else {
                if (h.month === month && h.day === day) {
                    return h.name;
                }
            }
        }
        return null;
    },
    
    getHolidayName(date) {
        return this.isHoliday(date);
    }
};

// Initialize from localStorage
Holidays.setCountry(Holidays.getCountry());