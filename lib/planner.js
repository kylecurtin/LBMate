import { nextDepartures } from './gtfs.js';
import { getRealtime, applyRealtime } from './realtime.js';
import { nextFromLirr, nextAtStopH } from './bus.js';

const SUBWAY_PENN_TO_FIDI_MIN = 25;
const MIN_TRAIN_TO_BUS_TRANSFER_MIN = 1;
const MIN_BUS_TO_TRAIN_TRANSFER_MIN = 4;
const BUS_H_TO_LIRR_MIN = 7; // H is 3rd-to-last stop; after H -> I -> J -> deadhead back to A


function epochToFriendly(epoch) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(epoch * 1000));
}

async function fetchTrains(direction, now, n) {
  const gtfs = globalThis.__GTFS__;
  const scheduled = nextDepartures({ gtfs, direction, nowDate: now, n });
  let rt = null;
  try { rt = await getRealtime(); } catch (e) {}
  return scheduled.map((s) => rt ? applyRealtime(s, rt) : { ...s, rt: { matched: false } });
}

// To Long Beach: enumerate next trains Penn -> LBH. For each, pair with the first bus departing LIRR (A) after arrival.
export async function planHome({ now }) {
  const trains = await fetchTrains('toLB', now, 8);
  const buses = nextFromLirr(now, 25);
  const MAX_WAIT_MIN = 90;
  const options = [];
  for (const t of trains) {
    const busMatch = buses.find((b) => {
      const transferMin = (b.epoch - t.arrEpoch) / 60;
      if (transferMin > MAX_WAIT_MIN) return false;
      if (b.waitsForTrain) return transferMin >= -1;
      return transferMin >= MIN_TRAIN_TO_BUS_TRANSFER_MIN;
    });
    options.push({
      train: serializeTrain(t),
      bus: busMatch ? serializeBus(busMatch) : null,
      noBus: !busMatch,
      arriveStopHEpoch: busMatch ? busMatch.epochAtH : null,
      arriveStopHLabel: busMatch ? epochToFriendly(busMatch.epochAtH) : null,
      transferMin: busMatch ? Math.round((busMatch.epoch - t.arrEpoch) / 60) : null,
    });
  }
  return options;
}

// To Manhattan: enumerate next buses arriving at Stop H. For each, pair with the soonest train it can still catch.
// Trains list is the gating filter — a bus without a connecting train doesn't show up.
export async function planWork({ now }) {
  const trains = await fetchTrains('toCity', now, 14);
  const buses = nextAtStopH(now, 12);
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const options = [];

  for (const b of buses) {
    if (b.epoch < nowEpoch - 30) continue;
    const arriveLirrEpoch = b.epoch + BUS_H_TO_LIRR_MIN * 60;
    const trainMatch = trains.find((t) => (t.depEpoch - arriveLirrEpoch) / 60 >= MIN_BUS_TO_TRAIN_TRANSFER_MIN);
    if (!trainMatch) continue;
    const arriveOfficeEpoch = trainMatch.arrEpoch + SUBWAY_PENN_TO_FIDI_MIN * 60;
    options.push({
      bus: serializeBus(b),
      arriveLirrEpoch,
      arriveLirrLabel: epochToFriendly(arriveLirrEpoch),
      train: serializeTrain(trainMatch),
      arriveOfficeEpoch,
      arriveOfficeLabel: epochToFriendly(arriveOfficeEpoch),
      transferMin: Math.round((trainMatch.depEpoch - arriveLirrEpoch) / 60),
    });
    if (options.length >= 6) break;
  }
  return options;
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
    epochAtA: b.epochAtA,
    epochAtH: b.epochAtH,
  };
}
