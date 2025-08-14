#!/usr/bin/env python3
"""
Shared helpers for fetching POTA activation data and computing per-mode totals.

- Uses urllib from the stdlib (no external deps).
- Handles retries with exponential backoff on network errors and HTTP 429/5xx.
- Provides a simple token-bucket style rate limiter (requests per second).
"""
from __future__ import annotations
import json
import time
import math
import sys
import typing as t
from dataclasses import dataclass
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

API_ROOT = "https://api.pota.app"

@dataclass
class RateLimiter:
    """Very small token bucket: allow up to `rate` requests per second."""
    rate: float = 2.0
    _tokens: float = 0.0
    _last: float = time.time()

    def acquire(self):
        now = time.time()
        # add tokens since last
        self._tokens += (now - self._last) * self.rate
        # cap tokens to rate (burst of 1 second)
        self._tokens = min(self._tokens, self.rate)
        self._last = now
        # need 1 token to proceed
        if self._tokens < 1.0:
            # sleep until we accrue enough
            needed = 1.0 - self._tokens
            sleep_s = needed / self.rate if self.rate > 0 else 0.5
            time.sleep(sleep_s)
            self._tokens = 0.0
            self._last = time.time()
        else:
            self._tokens -= 1.0

def http_get_json(url: str, timeout: float = 15.0, headers: t.Optional[dict] = None) -> t.Any:
    hdrs = {
        "User-Agent": "POTAmap-modes-fetcher/1.0 (+https://pota.review)",
        "Accept": "application/json",
    }
    if headers:
        hdrs.update(headers)
    req = Request(url, headers=hdrs, method="GET")
    with urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    try:
        return json.loads(data.decode("utf-8"))
    except Exception:
        # attempt raw parse if not UTF-8
        return json.loads(data)

def fetch_activations_for_reference(reference: str, timeout: float = 15.0) -> list[dict]:
    """
    Fetch activation list for a specific park reference (e.g. 'US-8383').
    Returns a list of dicts with keys like qsosCW, qsosDATA, qsosPHONE, totalQSOs, qso_date, activeCallsign.
    """
    url = f"{API_ROOT}/park/activations/{reference}?count=all"
    return t.cast(list[dict], http_get_json(url, timeout=timeout))

def sum_mode_totals(activations: list[dict]) -> dict:
    """
    Given a list of activation dicts, sum CW/SSB/DATA counts robustly.
    Falls back across likely field names.
    """
    tot = {"cw": 0, "ssb": 0, "data": 0}
    for a in activations or []:
        # normalize keys
        cw   = a.get("qsosCW")    or a.get("cw")    or 0
        data = a.get("qsosDATA")  or a.get("data")  or 0
        ssb  = a.get("qsosPHONE") or a.get("phone") or 0
        # Ensure ints
        try:
            tot["cw"]   += int(cw)
        except Exception:
            pass
        try:
            tot["data"] += int(data)
        except Exception:
            pass
        try:
            tot["ssb"]  += int(ssb)
        except Exception:
            pass
    return tot

def with_retries(func, *args, max_retries: int = 5, backoff_initial: float = 0.75, **kwargs):
    """
    Run a function with retries on HTTP/URL errors.
    Retries on: HTTP 429, 500-599, URLError.
    """
    attempt = 0
    while True:
        try:
            return func(*args, **kwargs)
        except HTTPError as e:
            if e.code == 429 or 500 <= e.code < 600:
                attempt += 1
                if attempt > max_retries:
                    raise
                sleep_s = backoff_initial * (2 ** (attempt - 1))
                time.sleep(sleep_s)
                continue
            raise
        except URLError:
            attempt += 1
            if attempt > max_retries:
                raise
            sleep_s = backoff_initial * (2 ** (attempt - 1))
            time.sleep(sleep_s)
            continue

def iter_references_from_allparks(allparks_path: str) -> list[str]:
    """
    allparks.json can be an array of parks or an object with 'parks': [...].
    Each item must have a 'reference' field.
    """
    with open(allparks_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    parks = data.get("parks") if isinstance(data, dict) else data
    refs = []
    for p in parks:
        ref = p.get("reference") or p.get("ref") or p.get("id")
        if ref:
            refs.append(ref)
    return refs

def write_json(path: str, obj: t.Any):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2, sort_keys=True)
