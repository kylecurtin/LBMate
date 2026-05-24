import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GTFS_DIR = path.join(__dirname, '..', 'data', 'gtfs');

const LONG_BEACH_BRANCH_ROUTE_ID = '6';
const STOP_LBH = '113'; // Long Beach
const STOP_NYK = '237'; // Penn Station
const STOP_ATL = '241'; // Atlantic Terminal
const STOP_JAM = '102'; // Jamaica

// Minimal CSV parser for GTFS (handles quoted fields, no embedded newlines).
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i];
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') {
        out.push(cur);
        cur = '';
      } else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function read(name) {
  return parseCsv(fs.readFileSync(path.join(GTFS_DIR, name), 'utf8'));
}

// HH:MM:SS, possibly with hour >= 24 for after-midnight service. Returns seconds since midnight of service date.
function hmsToSec(s) {
  const [h, m, sec] = s.split(':').map(Number);
  return h * 3600 + m * 60 + sec;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}
function fmtTime(secOfDay) {
  const h = Math.floor(secOfDay / 3600);
  const m = Math.floor((secOfDay % 3600) / 60);
  return `${pad2(h % 24)}:${pad2(m)}`;
}

export function loadGtfs() {
  const stops = new Map();
  for (const row of read('stops.txt')) {
    stops.set(row.stop_id, { id: row.stop_id, code: row.stop_code, name: row.stop_name });
  }

  // service_id -> Set of YYYYMMDD strings
  const serviceDates = new Map();
  for (const row of read('calendar_dates.txt')) {
    if (row.exception_type !== '1') continue;
    if (!serviceDates.has(row.service_id)) serviceDates.set(row.service_id, new Set());
    serviceDates.get(row.service_id).add(row.date);
  }

  // trip_id -> { route_id, service_id, headsign, direction_id, peak }
  const trips = new Map();
  for (const row of read('trips.txt')) {
    if (row.route_id !== LONG_BEACH_BRANCH_ROUTE_ID) continue;
    trips.set(row.trip_id, {
      tripId: row.trip_id,
      routeId: row.route_id,
      serviceId: row.service_id,
      headsign: row.trip_headsign,
      directionId: row.direction_id,
      peak: row.peak_offpeak === '1',
    });
  }

  // For each Long Beach branch trip, collect ordered stop_times. We only need them when they touch LBH and/or NYK/ATL.
  const tripStops = new Map(); // trip_id -> array of { stopId, arrivalSec, departureSec, seq }
  for (const row of read('stop_times.txt')) {
    if (!trips.has(row.trip_id)) continue;
    if (!tripStops.has(row.trip_id)) tripStops.set(row.trip_id, []);
    tripStops.get(row.trip_id).push({
      stopId: row.stop_id,
      arrivalSec: hmsToSec(row.arrival_time),
      departureSec: hmsToSec(row.departure_time),
      seq: Number(row.stop_sequence),
    });
  }
  for (const arr of tripStops.values()) arr.sort((a, b) => a.seq - b.seq);

  // Build pair index: for each service_id, for direction (toCity/toLB), list of { tripId, departSec, arriveSec, transferAt? }
  // toCity = from LBH to NYK (or ATL); toLB = from NYK (or ATL) to LBH
  // Direct trains: those whose stops include both LBH and a terminal in the right order.
  const pairs = new Map(); // key: `${serviceId}|${dir}` -> array
  function pushPair(serviceId, dir, item) {
    const k = `${serviceId}|${dir}`;
    if (!pairs.has(k)) pairs.set(k, []);
    pairs.get(k).push(item);
  }

  for (const trip of trips.values()) {
    const stopsList = tripStops.get(trip.tripId);
    if (!stopsList) continue;
    const lbh = stopsList.find((s) => s.stopId === STOP_LBH);
    const nyk = stopsList.find((s) => s.stopId === STOP_NYK);
    const atl = stopsList.find((s) => s.stopId === STOP_ATL);
    const jam = stopsList.find((s) => s.stopId === STOP_JAM);
    if (!lbh) continue;

    // City terminal: prefer NYK, else ATL (most trains hit NYK).
    const city = nyk || atl;
    if (!city) {
      // Train doesn't reach a city terminal directly. Record as "transfer at JAM" if it hits Jamaica.
      if (!jam) continue;
      if (jam.seq > lbh.seq) {
        // toCity (LBH first then JAM)
        pushPair(trip.serviceId, 'toCity', {
          tripId: trip.tripId, direct: false, transferAt: 'JAM',
          departStop: STOP_LBH, departSec: lbh.departureSec,
          arriveStop: STOP_JAM, arriveSec: jam.arrivalSec,
          arriveTerminalName: 'Jamaica (transfer)',
          headsign: trip.headsign, peak: trip.peak,
        });
      } else {
        pushPair(trip.serviceId, 'toLB', {
          tripId: trip.tripId, direct: false, transferAt: 'JAM',
          departStop: STOP_JAM, departSec: jam.departureSec,
          arriveStop: STOP_LBH, arriveSec: lbh.arrivalSec,
          arriveTerminalName: 'Long Beach',
          headsign: trip.headsign, peak: trip.peak,
        });
      }
      continue;
    }

    const terminalName = nyk ? 'Penn Station' : 'Atlantic Terminal';
    const terminalId = nyk ? STOP_NYK : STOP_ATL;

    if (city.seq > lbh.seq) {
      // Eastbound on LIRR direction? No — trip goes LBH first then to city, so this is OUTBOUND going toward city.
      pushPair(trip.serviceId, 'toCity', {
        tripId: trip.tripId, direct: true,
        departStop: STOP_LBH, departSec: lbh.departureSec,
        arriveStop: terminalId, arriveSec: city.arrivalSec,
        arriveTerminalName: terminalName,
        headsign: trip.headsign, peak: trip.peak,
      });
    } else {
      pushPair(trip.serviceId, 'toLB', {
        tripId: trip.tripId, direct: true,
        departStop: terminalId, departSec: city.departureSec,
        arriveStop: STOP_LBH, arriveSec: lbh.arrivalSec,
        arriveTerminalName: 'Long Beach',
        originName: terminalName,
        headsign: trip.headsign, peak: trip.peak,
      });
    }
  }
  for (const arr of pairs.values()) arr.sort((a, b) => a.departSec - b.departSec);

  return { stops, serviceDates, trips, tripStops, pairs };
}

export function activeServicesFor(dateYYYYMMDD, gtfs) {
  const active = [];
  for (const [serviceId, dates] of gtfs.serviceDates) {
    if (dates.has(dateYYYYMMDD)) active.push(serviceId);
  }
  return active;
}

export function nextDepartures({ gtfs, direction, nowDate, n = 6, windowHours = 6 }) {
  // direction: 'toCity' (LBH -> NYK/ATL) or 'toLB' (NYK/ATL -> LBH)
  // nowDate: any JS Date — we interpret all wall-clock comparisons in America/New_York.
  const ymd = formatNyDate(nowDate);
  const nyNow = nyDateTimeParts(nowDate);
  const nowSec = nyNow.h * 3600 + nyNow.min * 60 + nyNow.s;

  const results = [];

  // Today's runs (some may have departSec > 86400 for after-midnight service).
  for (const sid of activeServicesFor(ymd, gtfs)) {
    const arr = gtfs.pairs.get(`${sid}|${direction}`) || [];
    for (const t of arr) {
      if (t.departSec >= nowSec - 60) {
        results.push({ ...t, serviceDate: ymd, depEpoch: toEpoch(ymd, t.departSec), arrEpoch: toEpoch(ymd, t.arriveSec) });
      }
    }
  }
  // Tomorrow's runs that happen "tonight" (rare) — skip for simplicity; GTFS encodes after-midnight as 24:xx on prior date.

  // If nothing left today within the window, peek into tomorrow.
  if (results.length < n) {
    const tomorrow = addDays(nowDate, 1);
    const tymd = formatNyDate(tomorrow);
    for (const sid of activeServicesFor(tymd, gtfs)) {
      const arr = gtfs.pairs.get(`${sid}|${direction}`) || [];
      for (const t of arr) {
        results.push({ ...t, serviceDate: tymd, depEpoch: toEpoch(tymd, t.departSec), arrEpoch: toEpoch(tymd, t.arriveSec) });
        if (results.length > n * 4) break;
      }
    }
  }

  results.sort((a, b) => a.depEpoch - b.depEpoch);
  const cutoff = nowDate.getTime() / 1000 + windowHours * 3600;
  return results.filter((r) => r.depEpoch <= cutoff).slice(0, n);
}

export function formatNyDate(d) {
  // Convert a Date (assumed local-ish) into YYYYMMDD using America/New_York calendar.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  return `${y}${m}${day}`;
}

export function nyDateTimeParts(d) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, min: get('minute'), s: get('second') };
}

function toEpoch(ymd, secOfDay) {
  // Approximate epoch for a (NY service-date, sec-of-day). LIRR after-midnight times go in same service date with secOfDay >= 86400.
  // Build NY local midnight epoch by formatting through Intl.
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  // NY midnight as UTC: get the offset for that date.
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); // noon UTC of that day
  const offsetMin = nyOffsetMinutes(probe);
  const midnightUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMin * 60 * 1000;
  return Math.floor(midnightUtcMs / 1000) + secOfDay;
}

function nyOffsetMinutes(d) {
  // Determine NY UTC offset for a given Date (handles DST).
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  const ny = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return Math.round((ny - utc) / 60000);
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export const Constants = { STOP_LBH, STOP_NYK, STOP_ATL, STOP_JAM, LONG_BEACH_BRANCH_ROUTE_ID };
export { fmtTime };
