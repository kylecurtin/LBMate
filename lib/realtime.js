import GtfsRT from 'gtfs-realtime-bindings';

const FEED_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/lirr%2Fgtfs-lirr';

let cache = { ts: 0, byTrip: new Map() };
const CACHE_MS = 25_000;

export async function getRealtime() {
  const now = Date.now();
  if (now - cache.ts < CACHE_MS) return cache;

  const res = await fetch(FEED_URL);
  if (!res.ok) throw new Error(`GTFS-RT fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const feed = GtfsRT.transit_realtime.FeedMessage.decode(buf);

  const byTrip = new Map();
  for (const e of feed.entity) {
    if (!e.tripUpdate) continue;
    const tu = e.tripUpdate;
    const tripId = tu.trip.tripId;
    const cancelled = tu.trip.scheduleRelationship === 3;
    const stopUpdates = new Map();
    for (const stu of tu.stopTimeUpdate || []) {
      stopUpdates.set(stu.stopId, {
        arrivalDelay: stu.arrival?.delay ?? null,
        departureDelay: stu.departure?.delay ?? null,
        arrivalTime: stu.arrival?.time ? Number(stu.arrival.time) : null,
        departureTime: stu.departure?.time ? Number(stu.departure.time) : null,
        scheduleRelationship: stu.scheduleRelationship,
      });
    }
    byTrip.set(tripId, { cancelled, stopUpdates });
  }
  cache = { ts: now, byTrip, header: feed.header };
  return cache;
}

export function applyRealtime(trip, rt) {
  // trip: scheduled item with tripId, departStop, departSec, arriveStop, arriveSec, depEpoch, arrEpoch
  const update = rt.byTrip.get(trip.tripId);
  if (!update) return { ...trip, rt: { matched: false } };
  const depU = update.stopUpdates.get(trip.departStop);
  const arrU = update.stopUpdates.get(trip.arriveStop);
  const out = { ...trip, rt: { matched: true, cancelled: update.cancelled } };
  if (depU?.departureTime) {
    out.depEpoch = depU.departureTime;
    out.depDelaySec = depU.departureDelay ?? null;
  }
  if (arrU?.arrivalTime) {
    out.arrEpoch = arrU.arrivalTime;
    out.arrDelaySec = arrU.arrivalDelay ?? null;
  }
  return out;
}
