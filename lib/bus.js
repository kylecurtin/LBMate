import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schedule = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bus_schedule.json'), 'utf8'));

function nyWeekday(d) {
  // 'Sun', 'Mon', etc., in America/New_York regardless of server timezone.
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(d);
}

function isWeekendNy(d) {
  const wd = nyWeekday(d);
  return wd === 'Sat' || wd === 'Sun';
}

// Fixed-date federal holidays the brochure treats as Sunday schedule.
const FIXED_HOLIDAYS = new Set([
  '01-01', // New Year's Day
  '06-19', // Juneteenth
  '07-04', // Independence Day
  '11-11', // Veterans Day
  '12-25', // Christmas
]);

function todayHolidayKey(d) {
  const np = nyParts(d);
  return `${String(np.m).padStart(2, '0')}-${String(np.d).padStart(2, '0')}`;
}

function nthWeekdayOfMonth(year, month, weekday, n) {
  // n: 1..4 for nth, 5 for LAST. weekday: 0=Sun..6=Sat. month: 1..12.
  if (n === 5) {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let d = lastDay; d > lastDay - 7; d--) {
      if (new Date(Date.UTC(year, month - 1, d)).getUTCDay() === weekday) return d;
    }
  } else {
    let count = 0;
    for (let d = 1; d <= 31; d++) {
      const date = new Date(Date.UTC(year, month - 1, d));
      if (date.getUTCMonth() !== month - 1) break;
      if (date.getUTCDay() === weekday) {
        count++;
        if (count === n) return d;
      }
    }
  }
  return -1;
}

function isFloatingHolidayNy(d) {
  const { y, m, d: day } = nyParts(d);
  if (m === 1 && day === nthWeekdayOfMonth(y, 1, 1, 3)) return true;  // MLK: 3rd Mon Jan
  if (m === 2 && day === nthWeekdayOfMonth(y, 2, 1, 3)) return true;  // Presidents Day: 3rd Mon Feb
  if (m === 5 && day === nthWeekdayOfMonth(y, 5, 1, 5)) return true;  // Memorial Day: last Mon May
  if (m === 9 && day === nthWeekdayOfMonth(y, 9, 1, 1)) return true;  // Labor Day: 1st Mon Sep
  if (m === 10 && day === nthWeekdayOfMonth(y, 10, 1, 2)) return true; // Columbus Day: 2nd Mon Oct
  if (m === 11 && day === nthWeekdayOfMonth(y, 11, 4, 4)) return true; // Thanksgiving: 4th Thu Nov
  return false;
}

function isSundayScheduleDay(d) {
  return isWeekendNy(d) || FIXED_HOLIDAYS.has(todayHolidayKey(d)) || isFloatingHolidayNy(d);
}

function scheduleFor(d) {
  return isSundayScheduleDay(d) ? schedule.weekend.runs : schedule.weekday.runs;
}

function nyParts(d) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, min: get('minute') };
}

function toEpochNY({ y, m, d, hhmm }) {
  const [h, min] = hhmm.split(':').map(Number);
  // Build epoch by computing offset for that date in NY.
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const offsetMin = nyOffsetMinutes(probe);
  const utcMs = Date.UTC(y, m - 1, d, h, min, 0) - offsetMin * 60 * 1000;
  return Math.floor(utcMs / 1000);
}

function nyOffsetMinutes(d) {
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  const ny = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return Math.round((ny - utc) / 60000);
}

// Next bus departures FROM a given stop, going forward from now.
// stop: 'A'..'J'. Returns next `n` runs with relevant times.
export function nextFromStop(stop, now, n = 5) {
  const np = nyParts(now);
  const today = scheduleFor(now);
  const tomorrow = scheduleFor(new Date(now.getTime() + 24 * 3600 * 1000));
  const ny = { y: np.y, m: np.m, d: np.d };
  const nyTomorrow = (() => {
    const t = new Date(now.getTime() + 24 * 3600 * 1000);
    const p = nyParts(t);
    return { y: p.y, m: p.m, d: p.d };
  })();

  const items = [];
  for (const run of today) {
    if (!run[stop]) continue;
    const epoch = toEpochNY({ ...ny, hhmm: run[stop] });
    if (epoch >= now.getTime() / 1000 - 30) items.push(buildItem(run, stop, epoch, ny));
  }
  if (items.length < n) {
    for (const run of tomorrow) {
      if (!run[stop]) continue;
      const epoch = toEpochNY({ ...nyTomorrow, hhmm: run[stop] });
      items.push(buildItem(run, stop, epoch, nyTomorrow));
      if (items.length >= n + 3) break;
    }
  }
  items.sort((a, b) => a.epoch - b.epoch);
  return items.slice(0, n);
}

function buildItem(run, stop, epoch, ymd) {
  return {
    stop,
    stopName: schedule.stops[stop],
    epoch,
    timeAtStop: run[stop],
    runOriginLirr: run.A,
    waitsForTrain: !!run.waitsForTrain,
    epochAtA: toEpochNY({ ...ymd, hhmm: run.A }),
    epochAtH: toEpochNY({ ...ymd, hhmm: run.H }),
  };
}

// For going home: bus departures FROM LIRR (stop A) — these are the runs the user catches off the train.
export function nextFromLirr(now, n = 6) {
  return nextFromStop('A', now, n);
}

// For going to work: bus arrivals AT stop H — these are the runs the user catches at home.
export function nextAtStopH(now, n = 6) {
  return nextFromStop('H', now, n);
}

export function arrivalAtLirrForRunDepartingA(runOriginLirrHHMM, now) {
  const today = scheduleFor(now);
  return today.find((r) => r.A === runOriginLirrHHMM) || null;
}

export function getStops() {
  return schedule.stops;
}
