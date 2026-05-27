#!/usr/bin/env python3
"""Generate data/bus_schedule.json from 'Long Beach Bus Schedule.xlsx'."""
import json
import os
import sys

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is required: pip install openpyxl")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = os.path.join(ROOT, "Long Beach Bus Schedule.xlsx")
OUT = os.path.join(ROOT, "data", "bus_schedule.json")


def to24(meridiem, a_time, h_time):
    def conv(t, mer):
        if not t:
            return None
        h = t.hour
        if mer == "PM" and h < 12:
            h += 12
        elif mer == "AM" and h == 12:
            h = 0
        return f"{h:02d}:{t.minute:02d}"

    a_str = conv(a_time, meridiem)
    h_str = conv(h_time, meridiem)
    # AM run where H rolls past noon (e.g. A=11:40, H=12:06) — Excel marks both AM.
    if a_time and h_time and h_time.hour == 12 and meridiem == "AM":
        h_str = f"12:{h_time.minute:02d}"
    return a_str, h_str


def main():
    wb = openpyxl.load_workbook(XLSX, data_only=True)
    ws = wb["Sheet1"]
    weekday, weekend = [], []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i < 3:
            continue
        mer_wk, a_wk, h_wk = row[0], row[1], row[2]
        mer_we, a_we, h_we = row[4], row[5], row[6]
        if a_wk and h_wk:
            a, h = to24(mer_wk, a_wk, h_wk)
            weekday.append({"A": a, "H": h})
        if a_we and h_we:
            a, h = to24(mer_we, a_we, h_we)
            weekend.append({"A": a, "H": h})

    out = {
        "source": "City of Long Beach West End Bus Schedule (Long Beach Bus Schedule.xlsx)",
        "route": "West End Loop",
        "stops": {
            "A": "LIRR Station",
            "H": "Grand & W. Beech (Sandcastles)",
        },
        "notes": {
            "directionality": "Each row is one bus loop run. A = time bus is at LIRR (board here heading west to Grand & W. Beech). H = time bus is at Grand & W. Beech (board here heading east back to LIRR).",
        },
        "weekday": {"runs": weekday},
        "weekend": {"runs": weekend},
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)
    print(f"Wrote {OUT}: {len(weekday)} weekday + {len(weekend)} weekend runs")


if __name__ == "__main__":
    main()
