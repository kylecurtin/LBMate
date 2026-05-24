import { nextDepartures, fmtTime } from './gtfs.js';
import { getRealtime, applyRealtime } from './realtime.js';
import { nextFromLirr, nextAtStopH } from './bus.js';

const SUBWAY_PENN_TO_FIDI_MIN = 25;
const SUBWAY_FIDI_TO_PENN_MIN = 25;
const WALK_HOME_TO_STOP_H_MIN = 10;
const WALK_STOP_H_TO_HOME_MIN = 10;
const SHOW_UP_EARLY_MIN = 10;
const MIN_TRAIN_TO_BUS_TRANSFER_MIN = 1; // bus waits for train when • flag set, otherwise need at least this much
const MIN_BUS_TO_TRAIN_TRANSFER_MIN = 4; // walking from bus drop to LIRR platform

function epochToHhmmNy(epoch) {
  const d = new Date(epoch * 1000);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

function epochToFriendly(epoch) {
  const d = new Date(epoch * 1000);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

async function fetchWithRt(direction, now, n) {
  const gtfs = globalThis.__GTFS__;
  const scheduled = nextDepartures({ gtfs, direction, nowDate: now, n });
  let rt;
  try {
    rt = await getRealtime();
  } catch (e) {
    rt = null;
  }
  return scheduled.map((s) => rt ? applyRealtime(s, rt) : { ...s, rt: { matched: false } });
}

export async function planHome({ now }) {
  // Strategy: enumerate next ~6 trains NYK -> LBH. For each, pair with the first bus departing LIRR (A) at or after train arrival + transfer buffer.
  const trains = await fetchWithRt('toLB', now, 8);
  const buses = nextFromLirr(now, 25);

  const MAX_REASONABLE_WAIT_MIN = 90; // beyond this, treat as "no connecting bus"
  const options = [];
  for (const t of trains) {
    const trainArrEpoch = t.arrEpoch;
    const busMatch = buses.find((b) => {
      const transferMin = (b.epoch - trainArrEpoch) / 60;
      if (transferMin > MAX_REASONABLE_WAIT_MIN) return false;
      if (b.waitsForTrain) return transferMin >= -1;
      return transferMin >= MIN_BUS_TO_TRAIN_TRANSFER_MIN;
    });
    const arriveHomeEpoch = busMatch
      ? busMatch.epoch + computeBusTravelMinutesAtoH(busMatch.runOriginLirr) * 60 + WALK_STOP_H_TO_HOME_MIN * 60
      : null;
    options.push({
      train: serializeTrain(t),
      bus: busMatch ? serializeBus(busMatch) : null,
      noBusTonight: !busMatch,
      arriveHomeEpoch,
      arriveHomeLabel: arriveHomeEpoch ? epochToFriendly(arriveHomeEpoch) : null,
      transferMin: busMatch ? Math.round((busMatch.epoch - trainArrEpoch) / 60) : null,
    });
  }
  return options;
}

export async function planWork({ now }) {
  // Strategy: enumerate next ~10 buses arriving at Stop H. Filter to ones still walkable-to from home (need at least the walk time of slack).
  // For each, pair with the first LIRR train departing LBH at or after bus_arrival_at_A + transfer buffer.
  const buses = nextAtStopH(now, 14);
  const trains = await fetchWithRt('toCity', now, 12);
  const nowEpoch = Math.floor(now.getTime() / 1000);

  const options = [];
  for (const b of buses) {
    const busAtHEpoch = b.epoch;
    const leaveHomeEpoch = busAtHEpoch - (SHOW_UP_EARLY_MIN + WALK_HOME_TO_STOP_H_MIN) * 60;
    // Drop options where the walk alone won't get user to the bus.
    if (busAtHEpoch - nowEpoch < WALK_HOME_TO_STOP_H_MIN * 60) continue;
    const leaveNow = leaveHomeEpoch < nowEpoch;
    // Compute bus arrival at LIRR (A). H is sequence 8 of 10; in the loop it's roughly 7 min from H to next-A (since J is at H+4 and the bus then deadheads to A).
    // We'll compute the "A" time of the SAME run is meaningless (A was the start). What we want is the time the bus reaches LIRR after H — which is after J.
    // Heuristic: bus arrives LIRR ~7 min after passing Stop H (3 min H->J, then ~3-5 min J -> LIRR deadhead).
    const arriveLirrEpoch = busAtHEpoch + 7 * 60;
    const trainMatch = trains.find((t) => {
      const transferMin = (t.depEpoch - arriveLirrEpoch) / 60;
      return transferMin >= MIN_BUS_TO_TRAIN_TRANSFER_MIN;
    });
    const arriveOfficeEpoch = trainMatch ? trainMatch.arrEpoch + SUBWAY_PENN_TO_FIDI_MIN * 60 : null;
    options.push({
      leaveHomeEpoch,
      leaveHomeLabel: epochToFriendly(leaveHomeEpoch),
      leaveNow,
      bus: serializeBus(b),
      arriveLirrEpoch,
      arriveLirrLabel: epochToFriendly(arriveLirrEpoch),
      train: trainMatch ? serializeTrain(trainMatch) : null,
      arriveOfficeEpoch,
      arriveOfficeLabel: arriveOfficeEpoch ? epochToFriendly(arriveOfficeEpoch) : null,
    });
    if (options.length >= 6) break;
  }
  return options;
}

function computeBusTravelMinutesAtoH(originLirrHHMM) {
  // Per schedule, A->H typically takes 19-25 minutes. Use a flat 22 minutes as fallback (we'd need to look up the exact run row for precision).
  // Note: this is only used for "arrive home" estimate after taking bus from LIRR.
  return 22;
}

function serializeTrain(t) {
  return {
    tripId: t.tripId,
    direct: t.direct,
    transferAt: t.transferAt || null,
    headsign: t.headsign,
    peak: t.peak,
    cancelled: !!t.rt?.cancelled,
    rtMatched: !!t.rt?.matched,
    depEpoch: t.depEpoch,
    arrEpoch: t.arrEpoch,
    depLabel: epochToFriendly(t.depEpoch),
    arrLabel: epochToFriendly(t.arrEpoch),
    depDelaySec: t.depDelaySec ?? 0,
    arrDelaySec: t.arrDelaySec ?? 0,
    fromName: t.originName || (t.departStop === '113' ? 'Long Beach' : 'Penn Station'),
    toName: t.arriveTerminalName,
  };
}

function serializeBus(b) {
  return {
    stop: b.stop,
    stopName: b.stopName,
    epoch: b.epoch,
    label: epochToFriendly(b.epoch),
    waitsForTrain: b.waitsForTrain,
    runOriginLirr: b.runOriginLirr,
  };
}
