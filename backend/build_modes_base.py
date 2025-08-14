
#!/usr/bin/env python3
from __future__ import annotations
import argparse, sys, json, random
from pota_modes_common import (
    RateLimiter, iter_references_from_allparks,
    with_retries, fetch_activations_for_reference, sum_mode_totals, write_json
)

def main():
    ap = argparse.ArgumentParser(description="Build modes-base.json with per-park CW/SSB/DATA totals.")
    ap.add_argument("--allparks", required=True, help="Path to allparks.json")
    ap.add_argument("--out", default="modes-base.json", help="Output JSON path")
    ap.add_argument("--rate", type=float, default=2.0, help="Requests/second throttle (default 2.0)")
    ap.add_argument("--resume", action="store_true", help="Resume if output file exists (skip already processed)")
    ap.add_argument("--checkpoint-every", type=int, default=500, help="Checkpoint every N parks (default 500)")
    ap.add_argument("--shuffle", action="store_true", help="Randomize processing order (helpful for load spreading)")
    args = ap.parse_args()

    refs = iter_references_from_allparks(args.allparks)

    out = []
    processed = set()
    if args.resume:
        try:
            with open(args.out, "r", encoding="utf-8") as f:
                out = json.load(f)
            processed = {row["reference"] for row in out if "reference" in row}
            print(f"Resuming: {len(processed)} already in {args.out}", file=sys.stderr)
        except FileNotFoundError:
            pass

    to_do = [r for r in refs if r not in processed]
    if args.shuffle:
        random.shuffle(to_do)

    rl = RateLimiter(rate=args.rate)
    count = len(out)

    for i, ref in enumerate(to_do, 1):
        rl.acquire()
        acts = with_retries(fetch_activations_for_reference, ref)
        totals = sum_mode_totals(acts)
        out.append({"reference": ref, **totals})
        count += 1
        if count % args.checkpoint_every == 0:
            write_json(args.out, out)
            print(f"[checkpoint] wrote {count} rows to {args.out}", file=sys.stderr)
        if i % 50 == 0:
            print(f"[{i}/{len(to_do)}] processed (total {count})", file=sys.stderr)

    write_json(args.out, out)
    print(f"Wrote {len(out)} entries to {args.out}")

if __name__ == "__main__":
    main()
