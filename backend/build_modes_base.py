#!/usr/bin/env python3
"""
Build modes-base.json by fetching per-park activations and summing CW/SSB/DATA.
Usage:
    python build_modes_base.py --allparks allparks.json --out modes-base.json [--rate 2.0]

- Reads park references from allparks.json (array or {"parks":[...]}).
- Fetches https://api.pota.app/park/activations/<ref>?count=all for each ref.
- Sums qsosCW / qsosPHONE / qsosDATA across all activations.
- Writes a compact list: [{"reference":"US-1234","cw":N,"ssb":M,"data":K}, ...]

Throttle with --rate (requests/second). Default 2 rps.
"""
from __future__ import annotations
import argparse
import sys
import json
from datetime import datetime
from pota_modes_common import (
    RateLimiter, iter_references_from_allparks,
    with_retries, fetch_activations_for_reference, sum_mode_totals, write_json
)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--allparks", required=True, help="Path to allparks.json")
    ap.add_argument("--out", default="modes-base.json", help="Output JSON path")
    ap.add_argument("--rate", type=float, default=2.0, help="Requests per second throttle (default 2.0)")
    args = ap.parse_args()

    refs = iter_references_from_allparks(args.allparks)
    rl = RateLimiter(rate=args.rate)

    out = []
    for i, ref in enumerate(refs, 1):
        rl.acquire()
        acts = with_retries(fetch_activations_for_reference, ref)
        totals = sum_mode_totals(acts)
        out.append({"reference": ref, **totals})
        if i % 50 == 0:
            print(f"[{i}/{len(refs)}] processed...", file=sys.stderr)

    write_json(args.out, out)
    print(f"Wrote {len(out)} entries to {args.out}")

if __name__ == "__main__":
    main()
