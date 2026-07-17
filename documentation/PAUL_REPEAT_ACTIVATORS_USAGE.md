# Finding repeat POTA activators by state

Paul,

For this report, do **not** scrape the HTML park pages on `pota.app`. POTAMap already uses the POTA JSON API for the same underlying activation-history data.

The relevant endpoint is:

```text
https://api.pota.app/park/activations/{reference}?count=all
```

So the workflow is:

1. Use POTAMap's local `potamap/data/allparks.json` to find every park in the state.
2. Make one API request per park reference.
3. Count the activation rows by activator callsign for that park.
4. Keep only callsigns whose count is greater than your threshold.

That means the recollection was mostly right: you need one trip to the API for each park, but **not** one trip for each activation.

## Command to run

From the POTAMap repository root:

```bash
python3 backend/activators_by_state.py \
  --state ME \
  --threshold 3 \
  --allparks potamap/data/allparks.json \
  --out repeat-activators-ME.csv \
  --rate 1.5
```

Change these values as needed:

- `--state ME`: the target state. You can use `ME` or `US-ME`.
- `--threshold 3`: only include callsigns with **more than** 3 activations at a park.
- `--out repeat-activators-ME.csv`: where to write the CSV report.
- `--rate 1.5`: throttle to 1.5 API requests per second.

## Output

The generated CSV has these columns:

```text
reference,name,callsign,activation_count
```

Example shape:

```csv
reference,name,callsign,activation_count
US-0001,Acadia National Park,N0CALL,5
US-0001,Acadia National Park,W1AW,4
```

## Smoke test first

Before running a full state, test the first few parks:

```bash
python3 backend/activators_by_state.py \
  --state ME \
  --threshold 3 \
  --allparks potamap/data/allparks.json \
  --out repeat-activators-ME-smoke.csv \
  --rate 1 \
  --limit 5
```

If that looks good, rerun without `--limit`.

## Notes

- Be polite to the API. If you are running large states or multiple states, use a lower `--rate`, such as `1` or `0.5`.
- The script retries transient API errors through POTAMap's existing retry helper.
- The endpoint is external to POTAMap and could change in the future, so this is best treated as a practical data-extraction helper rather than a stable long-term API contract.
