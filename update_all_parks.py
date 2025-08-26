#!/usr/bin/env python3

import json
import time
import requests
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent

# TESTING: use allparks2.json as the master file rather than allparks.json
LOCAL_FILE = BASE_DIR / 'allparks2.json'
CHANGES_FILE = BASE_DIR / 'changes.json'

API_ENDPOINTS = [
    'https://api.pota.app/program/parks/US',
    'https://api.pota.app/program/parks/CA',
    'https://api.pota.app/program/parks/GB',
    'https://api.pota.app/program/parks/NO',
    'https://api.pota.app/program/parks/IE'
]

# --- QSO counts updater helpers ---
RATE_LIMIT_PER_SEC = 10  # throttle to 10 requests/sec
SLEEP_BETWEEN_REQ = 1.0 / RATE_LIMIT_PER_SEC
ACTIVATIONS_API = 'https://api.pota.app/park/activations/{ref}?count=all'


def load_local_data(filename):
    try:
        with open(filename, 'r') as f:
            return {park['reference']: park for park in json.load(f)}
    except FileNotFoundError:
        return {}


def fetch_remote_data():
    combined = {}
    for url in API_ENDPOINTS:
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        for park in response.json():
            combined[park['reference']] = park
    return combined


def compare_parks(old_parks, new_parks):
    """
    Returns:
      changes: list of dicts describing non-QSO metadata changes (add/delete/rename/move/etc.)
      qsos_changed_refs: list of references whose 'qsos' value changed
    """
    changes = []
    qsos_changed_refs = []
    timestamp = datetime.utcnow().isoformat()

    old_keys = set(old_parks.keys())
    new_keys = set(new_parks.keys())

    added = new_keys - old_keys
    removed = old_keys - new_keys
    common = old_keys & new_keys

    for ref in added:
        changes.append({
            **new_parks[ref],
            'change': 'Park added',
            'timestamp': timestamp
        })

    for ref in removed:
        changes.append({
            **old_parks[ref],
            'change': 'Park deleted',
            'timestamp': timestamp
        })

    for ref in common:
        old = old_parks[ref]
        new = new_parks[ref]
        differences = []

        if old.get('name') != new.get('name'):
            differences.append('name changed')
        if old.get('latitude') != new.get('latitude') or old.get('longitude') != new.get('longitude'):
            differences.append('location changed')
        if old.get('locationDesc') != new.get('locationDesc'):
            differences.append('location description changed')
        if old.get('grid') != new.get('grid'):
            differences.append('grid changed')

        # Track QSO changes separately
        if old.get('qsos') != new.get('qsos'):
            qsos_changed_refs.append(ref)
            # If you ALSO want this noted in changes.json, uncomment the next line:
            # differences.append('qsos changed')

        if differences:
            changes.append({
                **new,
                'change': ', '.join(differences),
                'timestamp': timestamp
            })

    return changes, qsos_changed_refs


def write_json(filename, data):
    with open(filename, 'w') as f:
        json.dump(data, f, indent=2)


def write_lines(filename, lines):
    with open(filename, 'w') as f:
        for line in lines:
            f.write(f"{line}\n")


def classify_mode_to_bucket(mode: str) -> str:
    """
    Normalize a mode string from POTA into one of: 'cw', 'ssb', or 'data'.
    Everything not matching CW/SSB/PHONE is treated as DATA (e.g., FT8/FT4/RTTY/PSK/etc.).
    """
    if not mode:
        return 'data'
    m = str(mode).strip().lower()
    if m == 'cw':
        return 'cw'
    if m in ('ssb', 'phone', 'ph'):
        return 'ssb'
    return 'data'


def extract_qso_count(rec: dict) -> int:
    """Best-effort extraction of QSO count from an activation record."""
    for key in ('qsos', 'qsoCount', 'qso', 'count'):
        v = rec.get(key)
        if isinstance(v, int):
            return v
        # Sometimes it's a stringified int
        if isinstance(v, str) and v.isdigit():
            return int(v)
    # Some APIs return an explicit list of contacts
    contacts = rec.get('contacts')
    if isinstance(contacts, list):
        return len(contacts)
    return 0


def fetch_mode_totals_for_ref(ref: str) -> dict:
    """
    Call the POTA activations endpoint for a reference and return
    modeTotals as a dict: {'cw': int, 'data': int, 'ssb': int}

    Supports multiple payload shapes:
      1) {"modeTotals": {"cw":int,"data":int,"ssb":int}}
      2) [ { "qsosCW":int|str, "qsosDATA":int|str, "qsosPHONE":int|str, ... }, ... ]  # daily aggregates
      3) [ { "mode":"CW"|"SSB"|..., "qsos":int|str | "qsoCount":int|str | "contacts":[...] }, ... ]  # per-activation
    """
    url = ACTIVATIONS_API.format(ref=ref)
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    payload = resp.json()

    totals = {'cw': 0, 'data': 0, 'ssb': 0}

    # Helper to coerce possibly-string counts
    def as_int(v):
        try:
            return int(v)
        except (TypeError, ValueError):
            return 0

    # Case 1: API already returns an aggregate structure
    if isinstance(payload, dict) and isinstance(payload.get('modeTotals'), dict):
        mt = payload['modeTotals']
        totals['cw'] = as_int(mt.get('cw'))
        totals['data'] = as_int(mt.get('data'))
        totals['ssb'] = as_int(mt.get('ssb'))
        return totals

    # Case 2: Daily aggregates with explicit per-mode columns (matches sample.json)
    if isinstance(payload, list) and payload and (
        'qsosCW' in payload[0] or 'qsosDATA' in payload[0] or 'qsosPHONE' in payload[0]
    ):
        for rec in payload:
            totals['cw'] += as_int(rec.get('qsosCW'))
            totals['data'] += as_int(rec.get('qsosDATA'))
            totals['ssb'] += as_int(rec.get('qsosPHONE'))
        return totals

    # Case 3: Per-activation records, infer bucket from a mode field
    records = payload if isinstance(payload, list) else []
    for rec in records:
        mode = rec.get('mode') or rec.get('modeName')
        bucket = classify_mode_to_bucket(mode)
        # Try common count fields, fallback to contact list length
        count = None
        for key in ('qsos', 'qsoCount', 'qso', 'count'):
            if key in rec:
                count = as_int(rec.get(key))
                break
        if count is None and isinstance(rec.get('contacts'), list):
            count = len(rec['contacts'])
        totals[bucket] += (count or 0)

    return totals


def load_master_by_ref(filename: Path) -> dict:
    with open(filename, 'r') as f:
        data = json.load(f)
    # support both list-of-parks and dict-by-ref
    if isinstance(data, dict):
        return data
    if isinstance(data, list):
        return {p.get('reference'): p for p in data if p and p.get('reference')}
    return {}


def write_master_from_map(filename: Path, by_ref: dict):
    # Persist as a list, preserving other fields
    write_json(filename, list(by_ref.values()))


def update_qso_counts_for_refs(master_file: Path, refs_file: Path):
    print(f"Updating modeTotals for references listed in {refs_file.name}...")
    if not refs_file.exists():
        print("No updateQSO file found; skipping modeTotals update.")
        return

    # Load refs
    with open(refs_file, 'r') as f:
        refs = [line.strip() for line in f if line.strip()]

    if not refs:
        print("No references to update; skipping.")
        return

    # Load master map
    by_ref = load_master_by_ref(master_file)

    updated = 0
    total = len(refs)
    for idx, ref in enumerate(refs, start=1):
        try:
            totals = fetch_mode_totals_for_ref(ref)
            if ref in by_ref:
                by_ref[ref]['modeTotals'] = totals
                # Keep overall 'qsos' consistent with the buckets
                by_ref[ref]['qsos'] = int(totals.get('cw', 0)) + int(totals.get('data', 0)) + int(totals.get('ssb', 0))
                updated += 1
            else:
                print(f"Warning: reference {ref} not found in master; skipping.")
        except requests.HTTPError as e:
            print(f"HTTP error for {ref}: {e}")
        except Exception as e:
            print(f"Error for {ref}: {e}")
        finally:
            # throttle
            time.sleep(SLEEP_BETWEEN_REQ)

        if idx % 100 == 0 or idx == total:
            print(f"  Progress: {idx}/{total} refs processed...")

    write_master_from_map(master_file, by_ref)
    print(f"Updated modeTotals for {updated} parks. Wrote master to {master_file}.")


def main():
    print("Loading local data...")
    local_parks = load_local_data(LOCAL_FILE)

    print("Fetching remote park data...")
    new_parks = fetch_remote_data()

    print("Comparing park data...")
    changes, qsos_changed_refs = compare_parks(local_parks, new_parks)

    print(f"Found {len(changes)} non-QSO metadata changes.")
    if changes:
        write_json(CHANGES_FILE, changes)
        print(f"Changes written to {CHANGES_FILE}.")

    qso_update_file = None

    # If any QSO counts changed, write references to updateQSO.<timestamp> (UTC, filename-safe)
    if qsos_changed_refs:
        ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        qso_update_file = BASE_DIR / f"updateQSO.{ts}"
        write_lines(qso_update_file, sorted(qsos_changed_refs))
        print(f"Wrote {len(qsos_changed_refs)} references with QSO updates to {qso_update_file}.")

    # Always update the local master snapshot first (per your requirement)
    write_json(LOCAL_FILE, list(new_parks.values()))
    print(f"Updated park list written to {LOCAL_FILE}.")

    # Then, if we produced an updateQSO file, fetch per-mode totals and update the master
    if qso_update_file is not None:
        try:
            update_qso_counts_for_refs(LOCAL_FILE, qso_update_file)
        except Exception as e:
            print(f"ModeTotals update encountered an error: {e}")


if __name__ == '__main__':
    main()
