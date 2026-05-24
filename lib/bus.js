import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schedule = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bus_schedule.json'), 'utf8'));

function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

// Federal holidays the brochure treats as Sunday schedule.
const HOLIDAYS_RUNNING_SUNDAY = new Set([
  '01-01', // New Year's
  '07-04', // Independence Day
  '11-11', // Veterans Day
  '12-25', // Christmas
]);

function todayHolidayKey(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

function scheduleFor(d) {
  if (isWeekend(d) || HOLIDAYS_RUNNING_SUNDAY.has(todayHolidayKey(d))) return schedule.weekend.runs;
  return schedule.weekday.runs;
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
    if (epoch >= now.getTime() / 1000 - 30) items.push(buildItem(run, stop, epoch));
  }
  if (items.length < n) {
    for (const run of tomorrow) {
      if (!run[stop]) continue;
      const epoch = toEpochNY({ ...nyTomorrow, hhmm: run[stop] });
      items.push(buildItem(run, stop, epoch));
      if (items.length >= n + 3) break;
    }
  }
  items.sort((a, b) => a.epoch - b.epoch);
  return items.slice(0, n);
}

function buildItem(run, stop, epoch) {
  return {
    stop,
    stopName: schedule.stops[stop],
    epoch,
    timeAtStop: run[stop],
    runOriginLirr: run.A,
    waitsForTrain: !!run.waitsForTrain,
    runEndLaurelton: run.J,
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
  // Look up the run by its A departure time; return its J (Laurelton & Park) — A is start so LIRR arrival is the next run's A actually.
  // Simpler: return the time the bus reaches stop H from that LIRR-origin time (used when user gets off near home).
  const today = scheduleFor(now);
  const run = today.find((r) => r.A === runOriginLirrHHMM);
  return run || null;
}

export function getStops() {
  return schedule.stops;
}
