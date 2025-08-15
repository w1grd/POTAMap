# PQL (Park Query Language)

PQL lets you filter parks with structured terms in the search box.  
**Start every structured query with `?`**. Keys are **case-insensitive**; values are mostly case-insensitive too.

You can mix structured keys with **free text** (bare words or `"quoted phrases"`).  
Free text matches the park **name** and **reference** (e.g., `US-1234`), plus basic location text.

---

## Quick grammar

```
? KEY:VALUE KEY:VALUE ... ["free text"]
```

- Keys AND together (all conditions must match).
- Unknown keys are ignored (forward-compatible).
- Booleans accept `1|0|true|false`.
- Order doesn’t matter.

---

## Supported keys

| Key | Value | Meaning | Notes |
|---|---|---|---|
| `MODE` | `CW` \| `SSB` \| `PHONE` \| `DATA` \| `FT8` \| `FT4` | Selects a QSO “bucket” | `PHONE` == `SSB`. `FT8/FT4` map to `DATA`. |
| `MAX` | integer ≥ 0 | **Max QSOs** in the selected bucket | If `MODE` is set, applies to that mode’s QSO count. If no `MODE`, applies to **total QSOs**. Use `MAX:0` for “none yet”. |
| `MIN` | integer ≥ 0 | **Min QSOs** in the selected bucket | Mirrors `MAX`. With `MODE`, applies to that mode’s QSO count; otherwise to **total QSOs**. |
| `ACTIVE` | `1` \| `0` \| `true` \| `false` | Currently on-air | Uses live spot data; `ACTIVE:1` = only parks with a current spot. |
| `NEW` | `1` \| `0` \| `true` \| `false` | Recently added parks | `NEW:1` ≈ created in last 30 days. |
| `MINE` | `1` \| `0` \| `true` \| `false` | Your activations | `MINE:1` = only parks **you’ve activated**. `MINE:0` = parks you **haven’t** activated. |
| `STATE` | 2-letter code | U.S. state/territory filter | Accepts `MA`, `us-ma`, etc. Matches multi-state parks too. **Disables map-bounds** and auto-pans to results. |
| `MINDIST` | number with optional unit | Minimum distance from **you** | Default unit: miles. Accepts `mi`/`km` (e.g., `25km`). **Disables map-bounds** and auto-pans. |
| `MAXDIST` | number with optional unit | Maximum distance from **you** | Same units as above. **Disables map-bounds** and auto-pans. |
| `DIST` | `a-b`, `a-`, or `-b` (units optional) | Distance range shorthand | Examples: `DIST:20-50`, `DIST:-30km`, `DIST:100-`. **Disables map-bounds** and auto-pans. |
| `NFERWITH` | reference or comma list | Match parks that are NFER-neighbors of any given reference(s) | Example: `NFERWITH:US-6909` or `NFERWITH:US-6909,US-3857`. **Disables map-bounds** and auto-pans. |
 | `NFER` | `1` \| `0` \| `true` \| `false` | Match parks that have one or more n-fers asociated | Example: `NFER:1 STATE:MA` = parks in MA that might have an n-fer. |
### Global-scope behavior (auto-pan)
If your query includes **any** of: `STATE`, `DIST`/`MINDIST`/`MAXDIST`, or `NFERWITH`, the search is not limited to what’s currently visible on the map. The app will **fit/zoom to all matches** automatically.

---

## Examples

**Between 20 and 50 miles away, *zero CW* QSOs, not yet activated by you:**
```
?MINE:0 MODE:CW MAX:0 DIST:20-50
```

**Parks on the air (spotted now) in Massachusetts, DATA mode, with ≤10 QSOs:**
```
?ACTIVE:1 STATE:MA MODE:DATA MAX:10
```

**Recently added parks within 30 miles:**
```
?NEW:1 MAXDIST:30
```

**All parks you’ve already activated in Rhode Island:**
```
?MINE:1 STATE:RI
```

**DATA-light targets (≤5 QSOs data bucket) within 100 miles:**
```
?MODE:DATA MAX:5 MAXDIST:100
```

**Require at least 10 total QSOs (no mode specified):**
```
?MIN:10
```

**Require 1–5 CW QSOs (inclusive):**
```
?MODE:CW MIN:1 MAX:5
```

**NFER neighbors of US-6909 (all parks that are in US-6909’s NFER list, or vice versa):**
```
?NFERWITH:US-6909
```

**NFER neighbors of either US-6909 or US-3857 that you haven’t activated, within 60 miles:**
```
?NFERWITH:US-6909,US-3857 MINE:0 MAXDIST:60 SORT:DIST
```

**Free-text + structured: parks named “Lincoln Woods” with no CW QSOs:**
```
?"Lincoln Woods" MODE:CW MAX:0
```

**Use PHONE alias for SSB:**
```
?MODE:PHONE MAX:0
```

**Kilometers accepted: within 40 km and not yet activated by you:**
```
?MINE:0 MAXDIST:40km
```

---

## Tips

- If you start typing without `?`, the search runs as normal name/reference text search.
- `STATE` matches multi-state parks: `STATE:MA` will include parks that span MA/RI, MA/NH, etc.
- `MODE:FT8` or `MODE:FT4` are treated as `MODE:DATA`.
- Booleans accept `1/0` or `true/false`.
- `NFERWITH` is a **union** over the listed references (matches neighbors of *any* target).

---

## Known constraints

- `ACTIVE:1` depends on the live spots feed; results change as spots appear/expire.
- Distance requires a user location; use your browser’s geolocation or the “Center on My Location” button.
- `NFERWITH` depends on the available NFER graph in the dataset; if a park has no neighbors listed, it won’t match.

---

*This document reflects the current PQL implementation in POTAmap as of today.*
