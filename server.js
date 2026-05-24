import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGtfs } from './lib/gtfs.js';
import { planHome, planWork } from './lib/planner.js';
import { nextFromLirr, nextAtStopH, getStops } from './lib/bus.js';
import { nextDepartures } from './lib/gtfs.js';
import { getRealtime, applyRealtime } from './lib/realtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('[lbmate] loading GTFS...');
const t0 = Date.now();
globalThis.__GTFS__ = loadGtfs();
console.log(`[lbmate] GTFS loaded: ${globalThis.__GTFS__.trips.size} LIRR Long Beach branch trips in ${Date.now() - t0}ms`);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_, res) => {
  res.json({ ok: true, trips: globalThis.__GTFS__.trips.size, time: new Date().toISOString() });
});

app.get('/api/lirr/next', async (req, res) => {
  try {
    const dir = req.query.dir === 'toCity' ? 'toCity' : 'toLB';
    const n = Math.min(20, Number(req.query.n) || 6);
    const scheduled = nextDepartures({ gtfs: globalThis.__GTFS__, direction: dir, nowDate: new Date(), n });
    let rt = null;
    try { rt = await getRealtime(); } catch (e) {}
    const items = scheduled.map((s) => rt ? applyRealtime(s, rt) : { ...s, rt: { matched: false } });
    res.json({ direction: dir, items: items.map(simplifyTrain), rtAvailable: !!rt, rtAge: rt ? Math.round((Date.now() - rt.ts) / 1000) : null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/bus/next', (req, res) => {
  const stop = (req.query.stop || 'H').toUpperCase();
  const n = Math.min(20, Number(req.query.n) || 6);
  if (stop === 'A') return res.json({ stop, items: nextFromLirr(new Date(), n) });
  res.json({ stop, items: nextAtStopH(new Date(), n) });
});

app.get('/api/plan/home', async (_, res) => {
  try { res.json({ options: await planHome({ now: new Date() }) }); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/api/plan/work', async (_, res) => {
  try { res.json({ options: await planWork({ now: new Date() }) }); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/api/bus/stops', (_, res) => res.json(getStops()));

function simplifyTrain(t) {
  return {
    tripId: t.tripId,
    headsign: t.headsign,
    peak: t.peak,
    direct: t.direct,
    transferAt: t.transferAt || null,
    cancelled: !!t.rt?.cancelled,
    rtMatched: !!t.rt?.matched,
    depEpoch: t.depEpoch,
    arrEpoch: t.arrEpoch,
    depDelaySec: t.depDelaySec ?? 0,
    arrDelaySec: t.arrDelaySec ?? 0,
    fromName: t.originName || (t.departStop === '113' ? 'Long Beach' : t.arriveTerminalName === 'Jamaica (transfer)' ? 'Long Beach' : 'Penn Station'),
    toName: t.arriveTerminalName,
  };
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`[lbmate] listening on http://localhost:${port}`));
