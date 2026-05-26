# LBMate

An iOS-style PWA for commuting between **the Sandcastles** (730 W Broadway, Long Beach NY) and **20 West St, FiDi Manhattan**.

Pulls live LIRR data from the MTA GTFS-realtime feed and pairs each train with the optimal Long Beach municipal bus to/from your stop (**Stop H — Grand & W. Beech**).

## What it does

The hero is a **live ticking countdown** to one real transit anchor:

- **To Manhattan** — countdown to the next bus at Stop H. Cards show that bus → the LIRR train it catches → subway → office arrival estimate.
- **To Long Beach** — countdown to the next LIRR departure from Penn. Cards show that train → the Long Beach bus it pairs with → arrival time at Stop H.

Pairing logic is trains-as-gate: a bus only shows if it connects to an upcoming train. Live MTA real-time overlay marks delays / cancellations on the train card. Long Beach municipal bus schedule is baked in from the [city brochure PDF](https://www.longbeachny.gov/transportation), and the app uses the **Sunday/weekend schedule on federal holidays** (fixed and floating).

The walk between home and Stop H is intentionally **not modeled** — the countdown shows the real transit time, you subtract your own walk time.

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
public/         iOS-styled PWA shell (HTML/CSS/JS), manifest, service worker
server.js       Express + static + JSON APIs
lib/gtfs.js     LIRR static GTFS loader (Long Beach branch trips only)
lib/realtime.js MTA GTFS-realtime fetcher (25s cache)
lib/bus.js      Long Beach bus schedule lookup (weekday / weekend + holidays)
lib/planner.js  Bus↔train pairing logic
data/gtfs/      MTA LIRR static GTFS (refresh every few weeks)
data/bus_schedule.json  Baked-in West End loop times
```

### API endpoints

| | |
|---|---|
| `GET /api/plan/work` | "To Manhattan" — buses at Stop H paired with the next LIRR train to Penn |
| `GET /api/plan/home` | "To Long Beach" — trains NYK→LBH paired with the next bus from LIRR |
| `GET /api/lirr/next?dir=toCity\|toLB&n=6` | Raw upcoming LIRR options with RT overlay |
| `GET /api/bus/next?stop=H\|A&n=6` | Raw upcoming bus times at a given stop |
| `GET /api/health` | Liveness |

(Internal route names `home`/`work` predate the "To Long Beach"/"To Manhattan" relabel — kept for backwards compatibility with the SW-cached shell.)

### Refreshing the LIRR static GTFS

The static GTFS in `data/gtfs/` is what gives you scheduled departures (the real-time feed only covers the next ~2 hours of active trips). Refresh it every few weeks:

```bash
curl -L https://web.mta.info/developers/data/lirr/google_transit.zip -o /tmp/lirr.zip
rm data/gtfs/* && unzip -d data/gtfs /tmp/lirr.zip && rm data/gtfs/shapes.txt
```

### Refreshing the bus schedule

`data/bus_schedule.json` is hand-transcribed from the City of Long Beach transportation brochure. When a new brochure ships, re-pull from longbeachny.gov and update both `weekday.runs` and `weekend.runs`. The `waitsForTrain: true` flag is the `•` bullet next to the A (LIRR) column in the PDF. If the brochure changes which federal holidays it observes, update `FIXED_HOLIDAYS` and `isFloatingHolidayNy` in `lib/bus.js`.

## Assumptions to tune

Constants live at the top of `lib/planner.js`:

- `SUBWAY_PENN_TO_FIDI_MIN = 25`
- `BUS_H_TO_LIRR_MIN = 7`
- `MIN_BUS_TO_TRAIN_TRANSFER_MIN = 4`
- `MIN_TRAIN_TO_BUS_TRANSFER_MIN = 1`
