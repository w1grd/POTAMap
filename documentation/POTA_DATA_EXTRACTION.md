# Extracting repeat activators from POTA park pages

Prefer the POTA JSON API over scraping HTML from `pota.app` pages. POTAMap already uses one API call per park when a popup needs complete activation history:

```text
https://api.pota.app/park/activations/{reference}?count=all
```

That means Paul's recollection is effectively right for this particular report: to examine every park in a state and count repeat activators per park, you need one activation-history request for each matching park reference. You do **not** need to make one request per individual activation.

The local `potamap/data/allparks.json` file can provide the park references for a state. Each park record includes a `reference`, `name`, and `locationDesc` such as `US-ME`, which is enough to select the parks before calling the activation endpoint.

## Ready-to-run helper

Use `backend/activators_by_state.py` to generate a CSV of callsigns whose activation count at a park is greater than a threshold:

```bash
python3 backend/activators_by_state.py \
  --state ME \
  --threshold 3 \
  --allparks potamap/data/allparks.json \
  --out repeat-activators-ME.csv \
  --rate 1.5
```

The output columns are:

- `reference`
- `name`
- `callsign`
- `activation_count`

Use `--limit 5` for a small smoke test before running a whole state.

## Operational advice

- Keep a polite throttle. The helper defaults to 2 requests per second and accepts `--rate` if you want to slow it down.
- Resume manually by keeping the CSV and rerunning lower-rate batches if the API returns transient errors.
- Treat the API shape as external and subject to change. The helper checks several likely callsign fields (`activator`, `activatorCallsign`, `callsign`, `call`, and `stationCallsign`) to be tolerant.
- Cache results if you plan to run this repeatedly; full-state runs otherwise repeat the same per-park API calls.
