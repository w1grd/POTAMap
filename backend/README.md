
# POTA Modes Totals Tools — with Checkpoint/Resume

## Baseline build (resumable)

```bash
python build_modes_base.py   --allparks /path/to/allparks.json   --out modes-base.json   --rate 3.0   --resume   --checkpoint-every 500   --shuffle
```

- **--resume**: skips references already present in the output file.
- **--checkpoint-every**: writes a checkpoint every N new parks.
- **--shuffle**: randomizes order to reduce locality spikes.

## Nightly update (rolling window + optional flat latest)

```bash
python update_mode_changes.py   --changes changes.json   --out mode-changes.json   --days 10   --rate 3.0   --emit-latest mode-changes-latest.json
```

- `mode-changes.json` keeps the last N day-batches.
- `mode-changes-latest.json` is a flattened list of the most recent totals for each reference.

## Notes
- Retries honor **Retry-After** and use jittered exponential backoff.
- Rate limiting is a small token bucket with jitter to smooth bursts.
- All scripts are stdlib-only (no external dependencies).
