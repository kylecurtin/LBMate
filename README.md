# LBMate

An iOS-style PWA for commuting between **730 W Broadway, Long Beach NY** and **20 West St, FiDi Manhattan**.

Pulls live LIRR data from the MTA GTFS-realtime feed and pairs each train with the optimal Long Beach municipal bus to/from your stop (**Stop H — Grand & W. Beech**).

## What it does

- **Going Home** — Pairs upcoming NYK→LBH trains with the next bus leaving the LIRR station, and tells you when you'll be home.
- **Going to Work** — Walks back from your bus options at Stop H: when to leave the house, which bus to catch, which train it connects to, when you'll be at Penn.
- Live MTA real-time overlay (delays / cancellations shown on the train card).
- Long Beach municipal bus schedule baked in from the [city brochure PDF](https://www.longbeachny.gov/transportation).
- Buffers built in: 10-min walk to stop + 10-min show-up-early = leave 20 min before scheduled bus.

## Run locally

```bash
npm install
npm start
# open http://localhost:3000
```

To use it from your phone on the same Wi-Fi: open `http://<your-mac-ip>:3000` in Safari, tap Share → Add to Home Screen.

## Deploy to Google Cloud Run

You have Claude wired to GCP, so this is one command after auth:

```bash
gcloud run deploy lbmate \
  --source . \
  --region us-east1 \
  --allow-unauthenticated \
  --memory 256Mi \
  --cpu 1 \
  --max-instances 2
```

Then open the printed `https://lbmate-…run.app` URL in Safari on your iPhone and tap **Share → Add to Home Screen**. The PWA manifest, service worker, and apple-touch-icons are already set up.

## Architecture

```
public/         iOS-styled PWA shell (HTML/CSS/JS), manifest, service worker
server.js       Express + static + JSON APIs
lib/gtfs.js     LIRR static GTFS loader (Long Beach branch trips only)
lib/realtime.js MTA GTFS-realtime fetcher (25s cache)
lib/bus.js      Long Beach bus schedule lookup (weekday / weekend)
lib/planner.js  Bus↔train pairing logic
data/gtfs/      MTA LIRR static GTFS (refresh every few weeks)
data/bus_schedule.json  Baked-in stop H times
```

### API endpoints

| | |
|---|---|
| `GET /api/plan/home` | Trains NYK→LBH paired with next bus to Stop H |
| `GET /api/plan/work` | Buses at Stop H paired with next LIRR train to Penn |
| `GET /api/lirr/next?dir=toCity\|toLB&n=6` | Raw upcoming LIRR options with RT overlay |
| `GET /api/bus/next?stop=H\|A&n=6` | Raw upcoming bus times at a given stop |
| `GET /api/health` | Liveness |

### Refreshing the LIRR static GTFS

The static GTFS in `data/gtfs/` is what gives you scheduled departures (the real-time feed only covers the next ~2 hours of active trips). Refresh it every few weeks:

```bash
curl -L https://web.mta.info/developers/data/lirr/google_transit.zip -o /tmp/lirr.zip
rm data/gtfs/* && unzip -d data/gtfs /tmp/lirr.zip && rm data/gtfs/shapes.txt
```

## Assumptions to tune

These are tuned in `lib/planner.js`:

- `WALK_HOME_TO_STOP_H_MIN = 10`
- `SHOW_UP_EARLY_MIN = 10`
- `SUBWAY_PENN_TO_FIDI_MIN = 25`
- `MIN_BUS_TO_TRAIN_TRANSFER_MIN = 4`

Edit and restart.
