#!/usr/bin/env python3

import json
import requests
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
LOCAL_FILE = BASE_DIR / 'allparks.json'
CHANGES_FILE = BASE_DIR / 'changes.json'

API_ENDPOINTS = [
    'https://api.pota.app/program/parks/US',
    'https://api.pota.app/program/parks/CA',
    'https://api.pota.app/program/parks/GB',
    'https://api.pota.app/program/parks/NO',
    'https://api.pota.app/program/parks/IE'
]

def load_local_data(filename):
    try:
        with open(filename, 'r') as f:
            return {park['reference']: park for park in json.load(f)}
    except FileNotFoundError:
        return {}

def fetch_remote_data():
    combined = {}
    for url in API_ENDPOINTS:
        response = requests.get(url)
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

    # If any QSO counts changed, write references to updateQSO.<timestamp> (UTC, filename-safe)
    if qsos_changed_refs:
        ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        qso_update_file = BASE_DIR / f"updateQSO.{ts}"
        write_lines(qso_update_file, sorted(qsos_changed_refs))
        print(f"Wrote {len(qsos_changed_refs)} references with QSO updates to {qso_update_file}.")

    # Always update the local allparks snapshot last
    write_json(LOCAL_FILE, list(new_parks.values()))
    print(f"Updated park list written to {LOCAL_FILE}.")

if __name__ == '__main__':
    main()
