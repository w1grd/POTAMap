
#!/usr/bin/env python3
from __future__ import annotations
import json, time, random
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from dataclasses import dataclass
import typing as t

API_ROOT = "https://api.pota.app"

def _sleep_with_jitter(base_seconds: float) -> None:
    jitter = base_seconds * random.uniform(-0.2, 0.2)
    time.sleep(max(0.0, base_seconds + jitter))

@dataclass
class RateLimiter:
    rate: float = 2.0
    _tokens: float = 0.0
    _last: float = time.time()
    def acquire(self):
        now = time.time()
        self._tokens += (now - self._last) * self.rate
        self._tokens = min(self._tokens, self.rate)
        self._last = now
        if self._tokens < 1.0:
            needed = 1.0 - self._tokens
            sleep_s = needed / self.rate if self.rate > 0 else 0.5
            _sleep_with_jitter(sleep_s)
            self._tokens = 0.0
            self._last = time.time()
        else:
            self._tokens -= 1.0

def http_get_json(url: str, timeout: float = 15.0, headers: t.Optional[dict] = None) -> t.Any:
    hdrs = {
        "User-Agent": "POTAmap-modes-fetcher/1.1",
        "Accept": "application/json",
    }
    if headers:
        hdrs.update(headers)
    req = Request(url, headers=hdrs, method="GET")
    with urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    return json.loads(data.decode("utf-8"))

def fetch_activations_for_reference(reference: str, timeout: float = 15.0) -> list[dict]:
    url = f"{API_ROOT}/park/activations/{reference}?count=all"
    return t.cast(list[dict], http_get_json(url, timeout=timeout))

def sum_mode_totals(activations: list[dict]) -> dict:
    tot = {"cw": 0, "ssb": 0, "data": 0}
    for a in activations or []:
        cw   = a.get("qsosCW")    or a.get("cw")    or 0
        data = a.get("qsosDATA")  or a.get("data")  or 0
        ssb  = a.get("qsosPHONE") or a.get("phone") or 0
        try: tot["cw"]   += int(cw)
        except Exception: pass
        try: tot["data"] += int(data)
        except Exception: pass
        try: tot["ssb"]  += int(ssb)
        except Exception: pass
    return tot

def with_retries(func, *args, max_retries: int = 5, backoff_initial: float = 0.75, **kwargs):
    attempt = 0
    while True:
        try:
            return func(*args, **kwargs)
        except HTTPError as e:
            if e.code == 429 or 500 <= e.code < 600:
                attempt += 1
                if attempt > max_retries:
                    raise
                retry_after = e.headers.get("Retry-After")
                if retry_after:
                    try:
                        delay = float(retry_after)
                    except ValueError:
                        try:
                            dt = parsedate_to_datetime(retry_after)
                            delay = max(0.0, (dt - datetime.now(dt.tzinfo)).total_seconds())
                        except Exception:
                            delay = backoff_initial * (2 ** (attempt - 1))
                else:
                    delay = backoff_initial * (2 ** (attempt - 1))
                _sleep_with_jitter(delay)
                continue
            raise
        except URLError:
            attempt += 1
            if attempt > max_retries:
                raise
            delay = backoff_initial * (2 ** (attempt - 1))
            _sleep_with_jitter(delay)

def iter_references_from_allparks(allparks_path: str) -> list[str]:
    with open(allparks_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    parks = data.get("parks") if isinstance(data, dict) else data
    refs = []
    for p in parks:
        ref = p.get("reference") or p.get("ref") or p.get("id")
        if ref:
            refs.append(ref)
    return refs

def write_json(path: str, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2, sort_keys=True)
