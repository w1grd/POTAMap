
#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, sys, os
from datetime import datetime, timezone
from pota_modes_common import (
    RateLimiter, with_retries, fetch_activations_for_reference,
    sum_mode_totals, write_json
)

def _load_changes(path: str):
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    refs = []
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, str):
                refs.append(item)
            elif isinstance(item, dict):
                r = item.get("reference") or item.get("ref") or item.get("id")
                if r: refs.append(r)
    return refs

def _load_existing(path: str):
    if not os.path.exists(path):
        return {"batches": []}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def main():
    ap = argparse.ArgumentParser(description="Update rolling mode-changes.json from nightly changes.")
    ap.add_argument("--changes", required=True, help="Path to changes.json (parks changed since last run)")
    ap.add_argument("--out", default="mode-changes.json", help="Output JSON path (rolling window)")
    ap.add_argument("--days", type=int, default=10, help="Days to keep (default 10)")
    ap.add_argument("--rate", type=float, default=2.0, help="Requests/second throttle (default 2.0)")
    ap.add_argument("--emit-latest", default="", help="Also write flattened latest totals to this path (optional)")
    args = ap.parse_args()

    refs = _load_changes(args.changes)
    if not refs:
        print("No changed parks found; nothing to do.")
        return

    rl = RateLimiter(rate=args.rate)
    today = datetime.now(timezone.utc).date().isoformat()

    batch = []
    for i, ref in enumerate(refs, 1):
        rl.acquire()
        acts = with_retries(fetch_activations_for_reference, ref)
        totals = sum_mode_totals(acts)
        batch.append({"reference": ref, **totals})
        if i % 50 == 0:
            print(f"[{i}/{len(refs)}] processed...", file=sys.stderr)

    store = _load_existing(args.out)
    existing_today = next((b for b in store.get("batches", []) if b.get("date") == today), None)
    if existing_today:
        by_ref = {c["reference"]: c for c in existing_today.get("changes", [])}
        for c in batch:
            by_ref[c["reference"]] = c
        existing_today["changes"] = list(by_ref.values())
    else:
        store.setdefault("batches", []).append({"date": today, "changes": batch})

    store["batches"].sort(key=lambda b: b.get("date",""), reverse=True)
    store["batches"] = store["batches"][: max(args.days, 1)]

    write_json(args.out, store)
    print(f"Wrote {len(batch)} changes into {args.out} (keeping {len(store['batches'])} day-batches)")

    if args.emit_latest:
        latest = {}
        for batch in store["batches"]:
            for c in batch.get("changes", []):
                latest[c["reference"]] = c
        write_json(args.emit_latest, list(latest.values()))
        print(f"Wrote {len(latest)} rows to {args.emit_latest}")

if __name__ == "__main__":
    main()
