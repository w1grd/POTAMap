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
| `MAX` | integer ≥ 0 | **Max QSOs** in the selected bucket | If `MODE` is set, applies to that mode’s QSO count. If no `MODE`, applies to **total QSOs**. (Use `MAX:0` for “none yet”.) |
| `ACTIVE` | `1` \| `0` \| `true` \| `false` | Currently on-air | Uses live spot data; `ACTIVE:1` = only parks with a current spot. |
| `NEW` | `1` \| `0` \| `true` \| `false` | Recently added parks | `NEW:1` ≈ created in last 30 days. |
| `MINE` | `1` \| `0` \| `true` \| `false` | Your activations | `MINE:1` = only parks **you’ve activated**. `MINE:0` = parks you **haven’t** activated. |
| `STATE` | 2-letter code | U.S. state/territory filter | Accepts `MA`, `us-ma`, etc. Matches multi-state parks too. |
| `MINDIST` | number with optional unit | Minimum distance from **you** | Default unit: miles. Accepts `mi`/`km` (e.g., `25km`). |
| `MAXDIST` | number with optional unit | Maximum distance from **you** | Same units as above. |
| `DIST` | `a-b`, `a-`, or `-b` (units optional) | Distance range shorthand | Examples: `DIST:20-50`, `DIST:-30km`, `DIST:100-` |

### Distance behavior
- If any distance key is present (`DIST`, `MINDIST`, `MAXDIST`), the query **uses distance instead of current map bounds**.
- Distance uses your geolocation (or “Center on My Location”). If your location isn’t available, distance filters won’t match.

---

## Examples

**Find parks between 20 and 50 miles away with *zero CW* QSOs (and not yet activated by you):**
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

---

## Known constraints

- `ACTIVE:1` depends on the live spots feed; results change as spots appear/expire.
- Distance requires a user location; use your browser’s geolocation or the “Center on My Location” button.

---

*This document reflects the current PQL implementation in POTAmap as of today.*
