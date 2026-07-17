#!/usr/bin/env python3
"""List repeat activators for every POTA park in a state.

This uses the public POTA API endpoint that POTAMap already uses for park
popup details: /park/activations/{reference}?count=all. It makes one API
request per park, then counts activation rows by callsign for that park.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from pota_modes_common import RateLimiter, fetch_activations_for_reference, with_retries


def load_parks(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    parks = data.get("parks") if isinstance(data, dict) else data
    if not isinstance(parks, list):
        raise ValueError(f"Expected a park list in {path}")
    return [p for p in parks if isinstance(p, dict)]


def normalize_state(state: str) -> str:
    state = state.strip().upper()
    return state[3:] if state.startswith("US-") else state


def park_matches_state(park: dict[str, Any], state: str) -> bool:
    wanted = normalize_state(state)
    raw = str(park.get("locationDesc") or park.get("location") or "").upper()
    tokens = [token.strip() for token in raw.replace(";", ",").replace("/", ",").split(",")]
    normalized = {normalize_state(token) for token in tokens if token.strip()}
    return wanted in normalized


def activation_callsign(row: dict[str, Any]) -> str | None:
    for key in ("activator", "activatorCallsign", "callsign", "call", "stationCallsign"):
        value = row.get(key)
        if value:
            return str(value).strip().upper()
    return None


def repeat_activators(reference: str, threshold: int) -> list[tuple[str, int]]:
    activations = with_retries(fetch_activations_for_reference, reference)
    counts = Counter(
        call for row in activations if isinstance(row, dict) for call in [activation_callsign(row)] if call
    )
    return sorted(
        ((call, count) for call, count in counts.items() if count > threshold),
        key=lambda item: (-item[1], item[0]),
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Find callsigns with more than N activations at each park in a state."
    )
    parser.add_argument("--state", required=True, help="Two-letter state, with or without US- prefix, e.g. ME or US-ME")
    parser.add_argument("--threshold", type=int, required=True, help="Only include callsigns with counts greater than this value")
    parser.add_argument("--allparks", default="potamap/data/allparks.json", help="Path to allparks.json")
    parser.add_argument("--out", default="-", help="CSV output path, or '-' for stdout")
    parser.add_argument("--rate", type=float, default=2.0, help="Requests per second throttle (default: 2.0)")
    parser.add_argument("--limit", type=int, default=0, help="Process only the first N matching parks; useful for smoke tests")
    args = parser.parse_args()

    parks = [p for p in load_parks(Path(args.allparks)) if park_matches_state(p, args.state)]
    parks.sort(key=lambda p: str(p.get("reference") or ""))
    if args.limit > 0:
        parks = parks[: args.limit]

    output = sys.stdout if args.out == "-" else open(args.out, "w", newline="", encoding="utf-8")
    try:
        writer = csv.DictWriter(output, fieldnames=["reference", "name", "callsign", "activation_count"])
        writer.writeheader()
        limiter = RateLimiter(rate=args.rate)
        for index, park in enumerate(parks, 1):
            reference = str(park.get("reference") or "")
            if not reference:
                continue
            print(f"[{index}/{len(parks)}] {reference}", file=sys.stderr)
            limiter.acquire()
            for callsign, count in repeat_activators(reference, args.threshold):
                writer.writerow(
                    {
                        "reference": reference,
                        "name": park.get("name") or "",
                        "callsign": callsign,
                        "activation_count": count,
                    }
                )
    finally:
        if output is not sys.stdout:
            output.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
