# LBMate

A PWA for commuting between **the Sandcastles** (730 W Broadway, Long Beach NY) and **20 West St, FiDi Manhattan**, with a Long Beach coastal theme — ocean-deep navy, sunset coral, sandy cream.

Pulls live LIRR data from the MTA GTFS-realtime feed and ties the Long Beach municipal bus schedule (Stop H — **Grand & W. Beech**) into a single anchor countdown per direction.

## What it does

The hero is a **live ticking countdown** to one real transit anchor per mode:

- **To Manhattan** — countdown to the next bus at Grand & W. Beech.
- **To Long Beach** — countdown to the next LIRR departure from Penn.

Below the hero is a flat list of the next few of the same thing (next buses at Stop H, or next LIRR trains to Long Beach, with live MTA badges for delays / cancellations / peak / via-Jamaica). No chained walk + subway + buffer estimates — you mentally subtract your own walk time from the one anchor you trust.

The Long Beach bus schedule uses the **Sunday/weekend schedule on federal holidays** (fixed and floating).

## Run locally

```bash
npm install
npm start
# open http://localhost:3000  (or http://127.0.0.1:3000)
```

The service worker is **disabled on localhost / 127.0.0.1** so edits show up immediately. On a phone on the same Wi-Fi: open `http://<your-mac-ip>:3000` in Safari, tap Share → Add to Home Screen.

## Deploy to Google Cloud Run

```bash
gcloud run deploy lbmate \
  --source . \
  --region us-east1 \
  --allow-unauthenticated \
  --memory 256Mi \
  --cpu 1 \
  --max-instances 2
```

Then open the printed `https://lbmate-…run.app` URL in Safari on your iPhone and tap **Share → Add to Home Screen**. The PWA manifest, service worker, and apple-touch-icons are wired up.

If a deploy doesn't show up in an installed PWA, bump the `CACHE` const in `public/sw.js` so the new shell evicts the old cache.

## Architecture

```
public/         Long Beach themed PWA shell (HTML/CSS/JS), manifest, service worker
server.js       Express + static + JSON APIs
lib/gtfs.js     LIRR static GTFS loader (Long Beach branch trips only)
lib/realtime.js MTA GTFS-realtime fetcher (25s cache)
lib/bus.js      Long Beach bus schedule lookup (weekday / weekend + holidays)
lib/planner.js  Bus↔train pairing logic (dormant — kept for reference, not used by the current frontend)
data/gtfs/      MTA LIRR static GTFS (refresh every few weeks)
data/bus_schedule.json   Generated from Long Beach Bus Schedule.xlsx
scripts/build_bus_schedule.py   xlsx → json generator
Long Beach Bus Schedule.xlsx    Source of truth for bus times (hand-maintained)
```

### API endpoints

| | |
|---|---|
| `GET /api/lirr/next?dir=toCity\|toLB&n=6` | Upcoming LIRR departures with realtime overlay (consumed by the "To Long Beach" view) |
| `GET /api/bus/next?stop=H\|A&n=6` | Upcoming bus times at a given stop (consumed by the "To Manhattan" view) |
| `GET /api/plan/work` | (legacy) Buses at Stop H paired with the next LIRR train to Penn — no longer used by the shell |
| `GET /api/plan/home` | (legacy) Trains NYK→LBH paired with the next bus from LIRR — no longer used by the shell |
| `GET /api/health` | Liveness |

### Refreshing the LIRR static GTFS

The static GTFS in `data/gtfs/` is what gives you scheduled departures (the real-time feed only covers the next ~2 hours of active trips). Refresh it every few weeks:

```bash
curl -L https://web.mta.info/developers/data/lirr/google_transit.zip -o /tmp/lirr.zip
rm data/gtfs/* && unzip -d data/gtfs /tmp/lirr.zip && rm data/gtfs/shapes.txt
```

### Refreshing the bus schedule

The source of truth is `Long Beach Bus Schedule.xlsx` at the repo root — two pairs of columns (weekday A/H, weekend A/H), each row a single loop run. `data/bus_schedule.json` is generated from it. When a new brochure ships, update the xlsx and regenerate:

```bash
python3 -m venv /tmp/xlsx_env && /tmp/xlsx_env/bin/pip install openpyxl
/tmp/xlsx_env/bin/python3 scripts/build_bus_schedule.py
```

If the brochure changes which federal holidays it observes, update `FIXED_HOLIDAYS` and `isFloatingHolidayNy` in `lib/bus.js`.

## Design notes

- One anchor per mode (next bus / next train). No chained "leave home" estimates, no subway time math in the UI. You subtract your own walk.
- Both endpoints of the commute are "home" — modes are labeled by destination (To Manhattan / To Long Beach), not by purpose (work / home).
- Visual palette tokens live at the top of `public/styles.css` (`--ocean-deep`, `--sunset-*`, `--sand*`, etc.) if you want to retune.
