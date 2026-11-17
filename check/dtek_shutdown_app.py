#!/usr/bin/env python3
"""DTEK Odesa shutdown schedule app - one command, no manual address typing.

Fetches the outage schedule for a saved address (default: м. Одеса,
Колонтаївська, 59) directly from the DTEK Odesa website API
(https://www.dtek-oem.com.ua/ua/shutdowns) and shows:

  * current status (power on / off / possible outage right now),
  * today's and tomorrow's confirmed hourly timeline,
  * the weekly plan for your outage group ("чергу"),
  * current emergency / stabilization / repair outages for the address.

Modes:
  python dtek_shutdown_app.py            web app on http://127.0.0.1:8787
                                        (opens your browser automatically)
  python dtek_shutdown_app.py --cli      print schedule to the terminal
  python dtek_shutdown_app.py --demo     offline demo with sample data
  python dtek_shutdown_app.py --cli --once   one-shot fetch (for cron)

Optional but recommended:  pip install curl_cffi
(the DTEK site is behind Imperva Incapsula; curl_cffi impersonates Chrome's
TLS fingerprint. Without it the app falls back to requests/urllib.)

Not affiliated with DTEK. Data comes from the public DTEK website and from
the community mirror github.com/Baskerville42/outage-data-ua (fallback).
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import secrets
import sys
import threading
import time
import urllib.parse
import webbrowser
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

try:  # make Windows terminals tolerate unicode blocks in --cli mode
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
except Exception:
    pass

KYIV = ZoneInfo("Europe/Kyiv")
APP_DIR = Path(__file__).resolve().parent
CONFIG_PATH = APP_DIR / "dtek_config.json"
CACHE_PATH = APP_DIR / "dtek_cache.json"
STREETS_CACHE_PATH = APP_DIR / "dtek_streets_cache.json"

BASE_URL = os.environ.get("DTEK_BASE_URL", "https://www.dtek-oem.com.ua").rstrip("/")
MIRROR_URL = os.environ.get(
    "DTEK_MIRROR_URL",
    "https://raw.githubusercontent.com/Baskerville42/outage-data-ua/main/data/odesa.json",
)
SHUTDOWN_PAGE = f"{BASE_URL}/ua/shutdowns"
AJAX_URL = f"{BASE_URL}/ua/ajax"

# Any updateFact value different from the server's current timestamp makes the
# server include the full "fact" + "preset" schedules in the getHomeNum reply.
FORCE_UPDATE_FACT = "01.01.2000 00:00"

DEFAULT_CONFIG = {
    "city": "м. Одеса",
    "street": "Колонтаївська",
    "house": "59",
    "group_override": "",          # e.g. "GPV3.1"; set to skip address lookup
    "port": 8787,
    "refresh_minutes": 5,
    "min_fetch_interval_seconds": 60,
}

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)
ACCEPT_LANGUAGE = "uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7"

CSRF_TOKEN_RE = re.compile(r'i:1;s:\d+:"([^"]+)"')
WAF_MARKERS = ("_Incapsula_Resource", "Request unsuccessful", "visid_incap")

# Slot status -> short English meaning (Ukrainian labels come from the API).
STATUS_GLOSS = {
    "yes": "power on",
    "no": "power off",
    "maybe": "possible outage",
    "first": "off first 30 min",
    "second": "off second 30 min",
    "mfirst": "maybe off first 30 min",
    "msecond": "maybe off second 30 min",
}
STATUS_UA = {
    "yes": "Світло є",
    "no": "Світла немає",
    "maybe": "Можливо відключення",
    "first": "Без світла перші 30 хв",
    "second": "Без світла другі 30 хв",
    "mfirst": "Можливо без світла перші 30 хв",
    "msecond": "Можливо без світла другі 30 хв",
}


class AppError(Exception):
    """User-facing error."""


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

def load_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except Exception as err:
            print(f"warning: could not read {CONFIG_PATH.name}: {err}", file=sys.stderr)
    for key in ("port", "refresh_minutes", "min_fetch_interval_seconds"):
        try:  # tolerate hand-edited values
            cfg[key] = int(cfg.get(key, DEFAULT_CONFIG[key]))
        except (TypeError, ValueError):
            cfg[key] = DEFAULT_CONFIG[key]
    for key in ("city", "street", "house", "group_override"):
        cfg[key] = str(cfg.get(key, "")).strip()
    return cfg


def save_config(cfg: dict) -> None:
    CONFIG_PATH.write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# --------------------------------------------------------------------------
# HTTP transports. curl_cffi (Chrome TLS impersonation) is the most reliable
# against Incapsula; requests and urllib are fallbacks.
# --------------------------------------------------------------------------

class BaseTransport:
    name = "base"

    def post(self, url: str, data: dict, headers: dict) -> tuple[int, str, dict]:
        raise NotImplementedError

    def get(self, url: str, headers: dict | None = None) -> tuple[int, str]:
        raise NotImplementedError


class CurlCffiTransport(BaseTransport):
    name = "curl_cffi"

    def __init__(self):
        from curl_cffi import requests as cffi_requests  # noqa: PLC0415

        self._session = cffi_requests.Session(impersonate="chrome124")

    def post(self, url, data, headers):
        r = self._session.post(url, data=data, headers=headers, timeout=45)
        return r.status_code, r.text, dict(r.headers)

    def get(self, url, headers=None):
        r = self._session.get(url, headers=headers or {}, timeout=45)
        return r.status_code, r.text


class RequestsTransport(BaseTransport):
    name = "requests"

    def __init__(self):
        import requests  # noqa: PLC0415

        self._session = requests.Session()
        self._session.headers["User-Agent"] = USER_AGENT

    def post(self, url, data, headers):
        r = self._session.post(url, data=data, headers=headers, timeout=45)
        return r.status_code, r.text, dict(r.headers)

    def get(self, url, headers=None):
        r = self._session.get(url, headers=headers or {}, timeout=45)
        return r.status_code, r.text


class UrllibTransport(BaseTransport):
    """Stdlib-only transport (no dependencies at all)."""

    name = "urllib"

    def __init__(self):
        import http.cookiejar
        import urllib.request

        self._jar = http.cookiejar.CookieJar()
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self._jar)
        )
        self._opener.addheaders = [("User-Agent", USER_AGENT)]

    def _cookie_header(self) -> str:
        return "; ".join(f"{c.name}={c.value}" for c in self._jar)

    def post(self, url, data, headers):
        import urllib.error
        import urllib.request

        body = urllib.parse.urlencode(data).encode()
        req = urllib.request.Request(url, data=body)
        for key, value in headers.items():
            req.add_header(key, value)
        try:
            with self._opener.open(req, timeout=45) as resp:
                return resp.status, resp.read().decode("utf-8", "replace"), dict(resp.headers)
        except urllib.error.HTTPError as err:
            return err.code, err.read().decode("utf-8", "replace"), dict(err.headers)

    def get(self, url, headers=None):
        req = urllib.request.Request(url)
        for key, value in (headers or {}).items():
            req.add_header(key, value)
        with self._opener.open(req, timeout=45) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")


def make_transports() -> list[BaseTransport]:
    transports: list[BaseTransport] = []
    for factory in (CurlCffiTransport, RequestsTransport, UrllibTransport):
        try:
            transports.append(factory())
        except Exception:
            continue
    return transports


# --------------------------------------------------------------------------
# DTEK AJAX client (Yii2 CSRF protocol on POST /ua/ajax)
# --------------------------------------------------------------------------

def mask_csrf_token(token: str) -> str:
    """Yii2 Security::maskToken - base64url(random_mask + (mask XOR token))."""
    raw = token.encode("utf-8")
    mask = secrets.token_bytes(len(raw))
    masked = bytes(a ^ b for a, b in zip(mask, raw))
    return base64.urlsafe_b64encode(mask + masked).decode("ascii")


class DtekAjaxClient:
    """Talks to the DTEK AJAX endpoint with automatic CSRF bootstrapping.

    The AJAX endpoint is not behind the JavaScript challenge that guards the
    HTML pages; it is protected by Yii2 CSRF validation instead:

      1. POST without a token -> HTTP 400 + ``_csrf-dtek-*`` cookie holding
         the serialized raw token,
      2. POST with ``X-CSRF-Token: <masked token>`` -> JSON.
    """

    def __init__(self, transports: list[BaseTransport] | None = None):
        self.transports = transports if transports is not None else make_transports()
        if not self.transports:
            raise AppError("No HTTP transport available (this should not happen).")
        self._transport = self.transports[0]
        self._token: str | None = None

    # -- low level ---------------------------------------------------------

    def _xhr_headers(self, token: str | None = None) -> dict:
        headers = {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": ACCEPT_LANGUAGE,
            "Origin": BASE_URL,
            "Referer": SHUTDOWN_PAGE,
            "X-Requested-With": "XMLHttpRequest",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Dest": "empty",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        }
        if token:
            headers["X-CSRF-Token"] = token
        return headers

    def _post(self, data: dict, token: str | None):
        return self._transport.post(AJAX_URL, data, self._xhr_headers(token))

    def _bootstrap_token(self) -> str:
        """Trigger the CSRF cookie and extract the raw token from it."""
        status, text, _ = self._post({"method": "getStreets"}, token=None)
        token = self._extract_token_from_cookies()
        if token is None:
            snippet = text[:160].replace("\n", " ")
            if any(m in text for m in WAF_MARKERS):
                raise AppError(
                    "DTEK bot protection (Incapsula) blocked this network. "
                    "Try again later, or from a different network (e.g. home "
                    "internet instead of a VPN/cloud connection)."
                )
            raise AppError(
                f"Could not obtain a CSRF token from the DTEK site "
                f"(HTTP {status}: {snippet!r})."
            )
        return token

    def _extract_token_from_cookies(self) -> str | None:
        jar = getattr(self._transport, "_jar", None)
        if jar is not None:  # urllib
            for cookie in jar:
                if cookie.name.startswith("_csrf"):
                    token = CSRF_TOKEN_RE.search(urllib.parse.unquote(cookie.value))
                    if token:
                        return token.group(1)
            return None
        session = getattr(self._transport, "_session", None)
        if session is None:
            return None
        jar = getattr(session, "cookies", None)
        items = []
        if hasattr(jar, "jar"):  # curl_cffi
            try:
                items = [(c.name, c.value) for c in jar.jar]
            except Exception:
                items = []
        elif hasattr(jar, "get_dict"):  # requests
            items = list(jar.get_dict().items())
        for name, value in items:
            if name.startswith("_csrf"):
                token = CSRF_TOKEN_RE.search(urllib.parse.unquote(value))
                if token:
                    return token.group(1)
        return None

    def _clear_csrf_cookies(self) -> None:
        session = getattr(self._transport, "_session", None)
        if session is None:
            return
        try:
            if hasattr(session.cookies, "clear"):
                session.cookies.clear()
        except Exception:
            pass

    def _switch_transport(self) -> bool:
        idx = self.transports.index(self._transport) + 1
        if idx >= len(self.transports):
            return False
        self._transport = self.transports[idx]
        self._token = None
        return True

    # -- public API --------------------------------------------------------

    def ajax(self, data: dict) -> dict:
        """POST to /ua/ajax with automatic CSRF handling and one retry."""
        try:
            return self._ajax_inner(data)
        except AppError:
            raise
        except Exception as err:  # transport-level failures (DNS, refused, TLS...)
            raise AppError(f"network error talking to DTEK: {err}") from err

    def _ajax_inner(self, data: dict) -> dict:
        attempt = 0
        while True:
            attempt += 1
            if self._token is None:
                self._token = self._bootstrap_token()
            status, text, _ = self._post(data, token=mask_csrf_token(self._token))

            if status == 400:  # stale token -> re-bootstrap once
                self._token = None
                self._clear_csrf_cookies()
                if attempt >= 3:
                    raise AppError("DTEK keeps rejecting the CSRF token.")
                continue

            if status == 403 or any(m in text for m in WAF_MARKERS):
                if self._switch_transport():
                    continue  # retry the whole flow on the next transport
                raise AppError(
                    "DTEK bot protection (Incapsula) blocked this network "
                    "(HTTP 403). If you run this at home it should pass; "
                    "cloud/VPN IPs are often blocked. Try: pip install curl_cffi"
                )
            if status == 429:
                raise AppError("DTEK rate limit (HTTP 429) - wait a couple of minutes.")
            if status != 200:
                raise AppError(f"DTEK answered HTTP {status}: {text[:160]!r}")

            try:
                payload = json.loads(text)
            except ValueError:
                raise AppError(f"DTEK returned invalid JSON: {text[:160]!r}") from None
            if payload.get("result") is False:
                raise AppError(f"DTEK returned result=false: {str(payload)[:200]}")
            return payload

    def get_streets(self, force: bool = False) -> dict[str, list[str]]:
        """Return {settlement: [street, ...]} using a 7-day disk cache."""
        if not force and STREETS_CACHE_PATH.exists():
            try:
                age_days = (time.time() - STREETS_CACHE_PATH.stat().st_mtime) / 86400
                if age_days < 7:
                    return json.loads(STREETS_CACHE_PATH.read_text(encoding="utf-8"))
            except Exception:
                pass
        payload = self.ajax({"method": "getStreets"})
        streets = payload.get("streets") or payload.get("data") or {}
        if isinstance(streets, list):  # some regions return a flat street list
            streets = {"м. Київ": [str(s) for s in streets]}
        clean = {
            str(city): [str(s) for s in names if s]
            for city, names in streets.items()
            if isinstance(names, list)
        }
        try:
            STREETS_CACHE_PATH.write_text(
                json.dumps(clean, ensure_ascii=False), encoding="utf-8"
            )
        except Exception:
            pass
        return clean

    def get_home_num(self, city: str, street: str, house: str) -> dict:
        form = {
            "method": "getHomeNum",
            "data[0][name]": "city",
            "data[0][value]": city,
            "data[1][name]": "street",
            "data[1][value]": street,
            "data[2][name]": "house_num",
            "data[2][value]": house,
            "data[3][name]": "updateFact",
            "data[3][value]": FORCE_UPDATE_FACT,
        }
        return self.ajax(form)


# --------------------------------------------------------------------------
# Mirror fallback (community copy of fact+preset, no address data)
# --------------------------------------------------------------------------

def fetch_mirror(transport: BaseTransport) -> dict:
    try:
        status, text = transport.get(MIRROR_URL, headers={"Accept": "application/json"})
    except Exception as err:
        raise AppError(f"network error fetching the mirror: {err}") from err
    if status != 200:
        raise AppError(f"Mirror answered HTTP {status}")
    try:
        return json.loads(text)
    except ValueError:
        raise AppError("mirror returned invalid JSON") from None


# --------------------------------------------------------------------------
# Address resolution
# --------------------------------------------------------------------------

_STREET_PREFIXES = (
    "вулиця", "вул.", "вул", "провулок", "пров.", "проспект", "просп.",
    "бульвар", "бул.", "набережна", "наб.", "узвіз", "пл.", "площа",
)


def _norm_street(name: str) -> str:
    """Lowercase, drop street-type prefixes and extra spaces."""
    s = " ".join(name.lower().split())
    changed = True
    while changed:
        changed = False
        for prefix in _STREET_PREFIXES:
            if s.startswith(prefix + " "):
                s = s[len(prefix):].strip()
                changed = True
    return s


def resolve_street(streets: dict[str, list[str]], city: str, wanted: str) -> str:
    """Find the exact DTEK spelling of a street (case/prefix tolerant)."""
    candidates = None
    for known_city, names in streets.items():
        if known_city.strip().lower() == city.strip().lower():
            candidates = names
            break
    if candidates is None:  # city not in directory
        raise AppError(
            f"Settlement {city!r} not found on the DTEK site. "
            f"Known: {len(streets)} settlements."
        )
    target = _norm_street(wanted)
    for name in candidates:  # exact normalized match first
        if _norm_street(name) == target:
            return name
    hits = [n for n in candidates if target and target in _norm_street(n)]
    if len(hits) == 1:
        return hits[0]
    if not hits:
        raise AppError(
            f"Street {wanted!r} not found in {city}. Check the spelling on "
            f"https://www.dtek-oem.com.ua/ua/shutdowns"
        )
    raise AppError(
        f"Street {wanted!r} is ambiguous: {', '.join(hits[:6])}. "
        f"Use the exact name from the site."
    )


_HOUSE_LOOKALIKES = str.maketrans("aceiopxkmhtbyABCEIOPX", "асеіорхкмнтвуАВСЕІОРХ")


def _norm_house(number: str) -> str:
    return "".join(number.split()).casefold().translate(_HOUSE_LOOKALIKES)


def find_house(data: dict, house: str) -> tuple[str, dict | list | None]:
    """Return (matched_key, raw_entry) with tolerant house-number matching."""
    if house in data:
        return house, data[house]
    wanted = _norm_house(house)
    for key, entry in data.items():
        if _norm_house(key) == wanted:
            return key, entry
    return house, None


# --------------------------------------------------------------------------
# Schedule parsing
# --------------------------------------------------------------------------

def _slot_entries(time_zone: dict) -> list[dict]:
    """Normalize time_zone into ordered [{key, label, start, end}] entries."""
    entries = []
    for key, value in (time_zone or {}).items():
        if isinstance(value, list):
            label = str(value[0]) if value else str(key)
            start = str(value[1]) if len(value) > 1 else label
            end = str(value[2]) if len(value) > 2 else ""
        else:
            label = start = str(value)
            end = ""
        entries.append({"key": str(key), "label": label, "start": start, "end": end})

    def sort_key(e):
        m = re.match(r"(\d{1,2}):(\d{2})", e["start"])
        return (int(m.group(1)), int(m.group(2))) if m else (99, 99)
    return sorted(entries, key=sort_key)


def _house_records(raw_entry) -> list[dict]:
    if isinstance(raw_entry, dict):
        return [raw_entry]
    if isinstance(raw_entry, list):
        return [r for r in raw_entry if isinstance(r, dict)]
    return []


def parse_house(raw_entry) -> dict:
    """Extract outage info + group ids from one house entry."""
    records = _house_records(raw_entry)
    groups: list[str] = []
    for rec in records:
        reasons = rec.get("sub_type_reason")
        if isinstance(reasons, str):
            reasons = [reasons]
        for gid in reasons or []:
            gid = str(gid).strip()
            if gid and gid not in groups:
                groups.append(gid)
    primary = next((r for r in records if r.get("sub_type") or r.get("start_date")), None)
    outage = None
    if primary:
        sub_type = str(primary.get("sub_type") or "").strip()
        start = str(primary.get("start_date") or "").strip()
        end = str(primary.get("end_date") or "").strip()
        raw_type = str(primary.get("type") or "").strip()
        if raw_type == "1" and not sub_type and (start or end):
            sub_type = "Планові ремонтні роботи"
        if sub_type or start:
            outage = {
                "description": sub_type,
                "start": start,  # "HH:MM DD.MM.YYYY"
                "end": end,
                "voluntarily": bool(primary.get("voluntarily")),
                "external": any(bool(r.get("cek")) for r in records),
            }
    return {
        "groups": groups,
        "primary_group": groups[0] if groups else None,
        "outage": outage,
    }


def _day_slots(slot_map: dict, time_zone: dict) -> list[dict]:
    """Order a raw {slot_key: status} map and attach labels."""
    order = {e["key"]: e for e in _slot_entries(time_zone)}
    result = []
    for key, status in slot_map.items():
        entry = order.get(str(key), {"key": str(key), "label": str(key), "start": "", "end": ""})
        result.append({
            "key": entry["key"],
            "label": entry["label"],
            "start": entry["start"],
            "end": entry["end"],
            "status": str(status),
        })
    def sort_key(s):
        m = re.match(r"(\d{1,2}):(\d{2})", s["start"] or s["label"])
        return (int(m.group(1)), int(m.group(2))) if m else (0, 0)
    return sorted(result, key=sort_key)


def _fact_day(fact: dict | None, target: date) -> dict | None:
    """Return the raw {group: slots} map for a calendar date, or None."""
    if not isinstance(fact, dict):
        return None
    days = fact.get("data") or {}
    for ts_str, groups in days.items():
        try:
            if datetime.fromtimestamp(int(ts_str), tz=KYIV).date() == target:
                return groups if isinstance(groups, dict) else None
        except (ValueError, OSError, OverflowError):
            continue
    return None


def _preset_day(preset: dict | None, target: date) -> dict | None:
    """Return the raw {group: slots} map for a weekday from the weekly plan."""
    if not isinstance(preset, dict):
        return None
    # DTEK weekday index: 1=Mon ... 7=Sun
    groups = (preset.get("data") or {})
    idx = target.isoweekday()
    day = {g: (days or {}).get(str(idx), {}) for g, days in groups.items() if isinstance(days, dict)}
    return day or None


def _now_minutes() -> int:
    now = datetime.now(KYIV)
    return now.hour * 60 + now.minute


def _slot_start_minutes(slot: dict) -> int | None:
    m = re.match(r"(\d{1,2}):(\d{2})", slot.get("start") or slot.get("label") or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def half_state(status: str, second_half: bool) -> str:
    """State ("on"/"off"/"maybe") of one 30-minute half of a slot."""
    full = {"yes": "on", "no": "off", "maybe": "maybe"}
    if status in full:
        return full[status]
    halves = {
        "first": ("off", "on"),
        "second": ("on", "off"),
        "mfirst": ("maybe", "on"),
        "msecond": ("on", "maybe"),
    }
    if status in halves:
        return halves[status][1 if second_half else 0]
    return "maybe"


def current_state(slots: list[dict], now_min: int) -> tuple[str, dict | None]:
    """Current power state from an ordered slot list."""
    current = None
    for slot in slots:
        start = _slot_start_minutes(slot)
        if start is None or start <= now_min:
            current = slot
        else:
            break
    if current is None:
        return "maybe", None
    start = _slot_start_minutes(current) or 0
    second_half = (now_min - start) >= 30
    return half_state(current["status"], second_half), current


def next_event(slots: list[dict], now_min: int) -> dict | None:
    """Next on/off transition inside this slot list, half-hour resolution."""
    state = None
    for slot in slots:
        start = _slot_start_minutes(slot)
        if start is None:
            continue
        if start <= now_min:
            state = half_state(slot["status"], (now_min - start) >= 30)
    for slot in slots:
        start = _slot_start_minutes(slot)
        if start is None:
            continue
        for offset, second_half in ((0, False), (30, True)):
            minute = start + offset
            if minute <= now_min:
                continue
            new_state = half_state(slot["status"], second_half)
            if new_state != state and new_state in ("on", "off"):
                hh, mm = divmod(minute, 60)
                return {"at": f"{hh:02d}:{mm:02d}", "state": new_state}
            state = new_state
    return None


def _fmt_minute(minute: int) -> str:
    hh, mm = divmod(minute % 1440, 60)
    return f"{hh:02d}:{mm:02d}"


def outage_windows_today(slots: list[dict]) -> list[dict]:
    """Merge off/maybe half-hours into precise readable windows."""
    windows: list[dict | None] = []
    for slot in slots:
        start = _slot_start_minutes(slot)
        if start is None:
            continue
        for half, (s, e) in enumerate(((start, start + 30), (start + 30, start + 60))):
            state = half_state(slot["status"], bool(half))
            mark = "off" if state == "off" else ("maybe" if state == "maybe" else None)
            if mark is None:
                if windows and windows[-1] is not None:
                    windows.append(None)  # gap closes the current window
                continue
            last = windows[-1] if windows else None
            if last is not None and last["kind"] == mark:
                last["until"] = _fmt_minute(e)
            else:
                windows.append({"kind": mark, "from": _fmt_minute(s), "until": _fmt_minute(e)})
    return [w for w in windows if w is not None]


def count_off_hours(slots: list[dict]) -> float:
    """Hours without power in a slot list, half-hour precise."""
    hours = 0.0
    for slot in slots:
        for half in (False, True):
            if half_state(slot["status"], half) == "off":
                hours += 0.5
    return hours


def build_status(cfg: dict, payload: dict, demo: bool = False) -> dict:
    """Turn a raw getHomeNum/mirror payload into the JSON the UI consumes."""
    now = datetime.now(KYIV)
    preset = payload.get("preset") or {}
    fact = payload.get("fact") or {}
    sch_names = preset.get("sch_names") or {}
    time_zone = preset.get("time_zone") or {}
    time_type = preset.get("time_type") or {}

    house_info = payload.get("_house_info") or {"groups": [], "primary_group": None, "outage": None}
    group = cfg.get("group_override") or house_info["primary_group"]
    excluded = not group

    today_slots, today_source = [], "none"
    if group:
        fact_today = _fact_day(fact, now.date())
        if fact_today and fact_today.get(group):
            today_slots = _day_slots(fact_today[group], time_zone)
            today_source = "fact"
        else:
            preset_today = _preset_day(preset, now.date())
            if preset_today and preset_today.get(group):
                today_slots = _day_slots(preset_today[group], time_zone)
                today_source = "preset"

    tomorrow_slots, tomorrow_source = [], "none"
    if group:
        fact_tom = _fact_day(fact, now.date() + timedelta(days=1))
        if fact_tom and fact_tom.get(group):
            tomorrow_slots = _day_slots(fact_tom[group], time_zone)
            tomorrow_source = "fact"
        else:
            preset_tom = _preset_day(preset, now.date() + timedelta(days=1))
            if preset_tom and preset_tom.get(group):
                tomorrow_slots = _day_slots(preset_tom[group], time_zone)
                tomorrow_source = "preset"

    week = []
    for i in range(7):
        day = now.date() + timedelta(days=i)
        raw = (_fact_day(fact, day) or {}).get(group) if group else None
        source = "fact" if raw else "preset"
        if raw is None and group:
            raw = (_preset_day(preset, day) or {}).get(group)
        week.append({
            "date": day.isoformat(),
            "name": preset.get("days", {}).get(str(day.isoweekday()), ""),
            "slots": _day_slots(raw, time_zone) if raw else [],
            "source": source,
        })

    now_min = now.hour * 60 + now.minute
    state, cur_slot = ("unknown", None) if excluded else current_state(today_slots, now_min)
    upcoming = None if excluded else next_event(today_slots, now_min)

    return {
        "ok": True,
        "demo": demo,
        "generated_at": now.strftime("%d.%m.%Y %H:%M:%S"),
        "address": {
            "city": cfg.get("city", ""),
            "street": cfg.get("street", ""),
            "house": cfg.get("house", ""),
            "street_exact": payload.get("_street_exact", ""),
            "house_key": payload.get("_house_key", ""),
        },
        "group": group,
        "group_name": sch_names.get(group, "") if group else "",
        "groups": house_info.get("groups", []),
        "excluded": excluded,
        "outage": house_info.get("outage"),
        "current": {
            "state": state,
            "slot": cur_slot["label"] if cur_slot else "",
            "range": (
                f"{cur_slot['start']}\u2013{cur_slot['end']}"
                if cur_slot and cur_slot.get("start") and cur_slot.get("end")
                else (cur_slot["label"] if cur_slot else "")
            ),
            "until_hint": upcoming["at"] if upcoming else "",
        },
        "next_event": upcoming,
        "today": {
            "date": now.date().isoformat(),
            "source": today_source,
            "slots": today_slots,
            "windows": outage_windows_today(today_slots),
        },
        "tomorrow": {
            "date": (now.date() + timedelta(days=1)).isoformat(),
            "source": tomorrow_source,
            "slots": tomorrow_slots,
        },
        "week": week,
        "legend": {s: {"ua": STATUS_UA.get(s, s), "en": STATUS_GLOSS.get(s, s)} for s in
                   ("yes", "no", "maybe", "first", "second", "mfirst", "msecond")},
        "time_type": time_type,
        "update_timestamp": payload.get("updateTimestamp")
        or payload.get("lastUpdated") or "",
        "update_fact": (fact or {}).get("update", ""),
    }


# --------------------------------------------------------------------------
# Data service: DTEK primary, mirror fallback, disk cache
# --------------------------------------------------------------------------

class ScheduleService:
    def __init__(self, cfg: dict, demo: bool = False):
        self.cfg = cfg
        self.demo = demo
        self._lock = threading.Lock()
        self._status: dict | None = None      # last built UI status
        self._error: str | None = None
        self._last_fetch = 0.0
        self._streets: dict[str, list[str]] | None = None
        if not demo:
            self._client = DtekAjaxClient()
            self._plain = UrllibTransport()  # for the mirror (no WAF there)

    # -- cache --------------------------------------------------------------

    def _load_cache(self) -> dict | None:
        if CACHE_PATH.exists():
            try:
                return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
            except Exception:
                return None
        return None

    def _save_cache(self, status: dict) -> None:
        try:
            CACHE_PATH.write_text(
                json.dumps(status, ensure_ascii=False), encoding="utf-8"
            )
        except Exception:
            pass

    # -- fetching -------------------------------------------------------------

    def _demo_payload(self) -> dict:
        """Sample payload: live community mirror schedules + a demo house."""
        mirror = fetch_mirror(UrllibTransport())
        return {
            "preset": mirror.get("preset") or {},
            "fact": mirror.get("fact") or {},
            "updateTimestamp": mirror.get("lastUpdated", ""),
            "_street_exact": "вул. Колонтаївська",
            "_house_key": "59",
            "_house_info": {
                "groups": ["GPV3.1"],
                "primary_group": "GPV3.1",
                "outage": None,
            },
        }

    def _live_payload(self) -> dict:
        city = self.cfg.get("city", "").strip()
        street = self.cfg.get("street", "").strip()
        house = self.cfg.get("house", "").strip()

        override = self.cfg.get("group_override", "").strip()
        if override:  # group pinned -> schedules only, via mirror if needed
            try:
                payload = self._client.get_home_num(city, street, house)
            except AppError:
                mirror = fetch_mirror(self._plain)
                mirror["_street_exact"] = street
                mirror["_house_key"] = house
                mirror["_house_info"] = {"groups": [override], "primary_group": override, "outage": None}
                return mirror
            payload["_house_info"] = {"groups": [override], "primary_group": override, "outage": None}
            return payload

        if self._streets is None:
            self._streets = self._client.get_streets()
        street_exact = resolve_street(self._streets, city, street)
        raw = self._client.get_home_num(city, street_exact, house)
        data = raw.get("data") or {}
        if not isinstance(data, dict):
            raise AppError("DTEK returned an unexpected house list format.")
        key, entry = find_house(data, house)
        if entry is None:
            numbers = ", ".join(sorted(data.keys(), key=lambda x: (len(x), x))[:40])
            raise AppError(
                f"House {house!r} not found on {street_exact!r}. "
                f"Houses known to DTEK: {numbers}"
            )
        payload = dict(raw)
        payload["_street_exact"] = street_exact
        payload["_house_key"] = key
        payload["_house_info"] = parse_house(entry)
        return payload

    def refresh(self, force: bool = False) -> dict:
        """Fetch (or demo-generate), build the status and cache it."""
        with self._lock:
            interval = max(15, int(self.cfg.get("min_fetch_interval_seconds", 60)))
            if not force and time.time() - self._last_fetch < interval:
                return self._status or {"ok": False, "loading": True}
            try:
                payload = self._demo_payload() if self.demo else self._live_payload()
                status = build_status(self.cfg, payload, demo=self.demo)
                self._status, self._error = status, None
                self._last_fetch = time.time()
                self._save_cache(status)
                return status
            except AppError as err:
                self._error = str(err)
                cached = self._load_cache()
                if cached is not None:
                    cached["stale"] = True
                    cached["error"] = self._error
                    self._status = cached
                    return cached
                self._last_fetch = time.time()
                return {"ok": False, "error": self._error}

    def status(self) -> dict:
        if self._status is not None:
            return self._status
        return self.refresh(force=True)

    def background_loop(self, refresh_seconds: int) -> None:
        while True:
            try:
                self.refresh()
            except Exception as err:  # keep the loop alive no matter what
                self._error = f"unexpected error: {err}"
            time.sleep(max(30, refresh_seconds))


# --------------------------------------------------------------------------
# Web UI (embedded single page) + local server
# --------------------------------------------------------------------------

HTML_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DTEK Odesa - Shutdown Schedule</title>
<style>
  :root{
    --bg:#0b1220; --card:#131c2e; --card2:#0f1727; --line:#223049;
    --text:#e7edf8; --muted:#8b98b5; --on:#22c55e; --off:#ef4444;
    --maybe:#f59e0b; --accent:#38bdf8;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
       font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:980px;margin:0 auto;padding:20px 16px 60px}
  header{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:18px}
  h1{font-size:20px;margin:0;display:flex;gap:10px;align-items:center}
  h1 .bolt{color:var(--accent)}
  .sub{color:var(--muted);font-size:13px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px}
  .row{display:flex;flex-wrap:wrap;gap:14px;align-items:center}
  .hero{display:flex;flex-wrap:wrap;gap:18px;align-items:center;justify-content:space-between}
  .state{font-size:34px;font-weight:700;letter-spacing:.5px}
  .state.on{color:var(--on)} .state.off{color:var(--off)} .state.maybe{color:var(--maybe)}
  .state.unknown{color:var(--muted)}
  .badge{display:inline-block;background:var(--card2);border:1px solid var(--line);
         border-radius:999px;padding:3px 12px;font-size:13px;margin:2px 4px 2px 0}
  .badge b{color:var(--accent)}
  .muted{color:var(--muted)} .small{font-size:13px}
  .timeline{display:flex;gap:2px;margin:8px 0 2px}
  .cell{flex:1;height:34px;border-radius:4px;min-width:4px;cursor:default}
  .cell.cur{outline:2px solid #fff;outline-offset:1px}
  .ruler{display:flex;gap:2px;color:var(--muted);font-size:10px}
  .ruler span{flex:1;text-align:left;transform:translateX(-1px)}
  h2{font-size:15px;margin:0 0 6px;font-weight:600}
  h2 .src{font-weight:400;color:var(--muted);font-size:12px}
  .weekrow{display:flex;align-items:center;gap:8px;margin:5px 0}
  .dayname{width:96px;flex:none;color:var(--muted);font-size:13px}
  .weekrow .timeline{flex:1;margin:0}
  .weekrow .cell{height:20px}
  .legend{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}
  .legend .item{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--muted)}
  .sw{width:14px;height:14px;border-radius:3px;display:inline-block}
  .banner{border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:14px}
  .banner.err{background:#3b1214;border:1px solid #7f1d1d;color:#fecaca}
  .banner.stale{background:#3a2a0c;border:1px solid #92600a;color:#fde68a}
  .banner.demo{background:#0c2a3a;border:1px solid #155e75;color:#bae6fd}
  button{background:var(--accent);color:#04121d;border:0;border-radius:8px;
         padding:8px 16px;font-weight:600;font-size:14px;cursor:pointer}
  button:disabled{opacity:.5;cursor:wait}
  input{background:var(--card2);border:1px solid var(--line);color:var(--text);
        border-radius:8px;padding:8px 10px;font-size:14px;width:180px}
  details summary{cursor:pointer;color:var(--muted)}
  form{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;align-items:end}
  label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted)}
  footer{color:var(--muted);font-size:12px;text-align:center;margin-top:8px}
  .winlist{margin:6px 0 0;padding-left:0;list-style:none}
  .winlist li{margin:2px 0}
  .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1><span class="bolt">&#9889;</span> DTEK Odesa &middot; Shutdown Schedule</h1>
      <div class="sub" id="addr">loading address&hellip;</div>
    </div>
    <div class="row">
      <span class="sub" id="updated"></span>
      <button id="btnRefresh" onclick="doRefresh()">&#8635; Refresh</button>
    </div>
  </header>

  <div id="banners"></div>

  <div class="card hero" id="heroCard">
    <div>
      <div class="state" id="state">&hellip;</div>
      <div class="sub" id="stateSub"></div>
    </div>
    <div id="badges" style="text-align:right"></div>
  </div>

  <div class="card" id="outageCard" style="display:none"></div>

  <div class="card">
    <h2>Today <span class="src" id="todaySrc"></span></h2>
    <div class="timeline" id="todayTl"></div>
    <div class="ruler" id="todayRuler"></div>
    <ul class="winlist" id="todayWins"></ul>
  </div>

  <div class="card" id="tomorrowCard" style="display:none">
    <h2>Tomorrow <span class="src" id="tomorrowSrc"></span></h2>
    <div class="timeline" id="tomorrowTl"></div>
    <div class="ruler" id="tomorrowRuler"></div>
  </div>

  <div class="card">
    <h2>Next 7 days <span class="src">&mdash; planned weekly schedule (today = confirmed when published)</span></h2>
    <div id="week"></div>
    <div class="legend" id="legend"></div>
  </div>

  <div class="card">
    <details>
      <summary>Settings &mdash; change address</summary>
      <form onsubmit="saveAddress(event)">
        <label>Settlement (населений пункт)<input id="inCity" placeholder="м. Одеса"></label>
        <label>Street (вулиця)<input id="inStreet" placeholder="Колонтаївська"></label>
        <label>House (будинок)<input id="inHouse" placeholder="59" style="width:90px"></label>
        <button type="submit">Save &amp; update</button>
      </form>
      <p class="small muted" style="margin-bottom:0">Use the spelling from
        <a style="color:var(--accent)" href="https://www.dtek-oem.com.ua/ua/shutdowns" target="_blank" rel="noreferrer">dtek-oem.com.ua/ua/shutdowns</a>
        &mdash; the app matches it automatically (вул./пров. prefixes are optional).</p>
    </details>
  </div>

  <footer>Data: DTEK Odesa public schedule site &middot; community mirror fallback &middot;
    auto-refresh every <span id="refMin"></span> min &middot; times in Kyiv time</footer>
</div>

<script>
const REFRESH_MS = __REFRESH_MS__;

const COL = {
  on:'#22c55e', off:'#ef4444', maybe:'#f59e0b'
};
function statusColors(s){
  const first = s==='first' ? 'off' : (s==='mfirst' ? 'maybe' : 'on');
  const second = s==='second' ? 'off' : (s==='msecond' ? 'maybe' : 'on');
  return [first, second];
}
function cellStyle(s){
  if (COL[s]) return 'background:'+COL[s];
  const [a,b] = statusColors(s);
  return 'background:linear-gradient(180deg,'+COL[a]+' 0 50%,'+COL[b]+' 50% 100%)';
}
function gloss(s, data){
  const l = (data.legend||{})[s];
  return l ? (l.ua+' / '+l.en) : s;
}

function renderSlots(slots, curLabel){
  const tl = [];
  slots.forEach(s=>{
    const div = document.createElement('div');
    div.className = 'cell' + (s.label===curLabel ? ' cur':'');
    div.style.cssText = cellStyle(s.status);
    div.title = (s.start||s.label)+' \u2014 '+gloss(s.status, DATA);
    tl.push(div);
  });
  return tl;
}
function renderRuler(slots){
  const r = [];
  slots.forEach((s,i)=>{
    const span = document.createElement('span');
    span.textContent = (i%2===0) ? (s.start||s.label).slice(0,2) : '';
    r.push(span);
  });
  return r;
}

let DATA = null;

function setState(el, state, text){
  el.className = 'state '+state;
  el.textContent = text;
}

function render(data){
  DATA = data;
  const b = (html)=>{const d=document.createElement('div');d.innerHTML=html;return d.firstElementChild;};
  const banners = document.getElementById('banners');
  banners.innerHTML = '';
  if (data.demo){
    banners.appendChild(b('<div class="banner demo"><b>Demo mode</b> &mdash; sample data ' +
      '(community mirror schedules, demo house group). Run without --demo for live data.</div>'));
  }
  if (data.stale){
    banners.appendChild(b('<div class="banner stale">Could not reach DTEK just now' +
      (data.error?(' &mdash; '+data.error):'') + '. Showing the last saved schedule.</div>'));
  }
  if (!data.ok){
    banners.appendChild(b('<div class="banner err"><b>Could not load the schedule.</b> '+
      (data.error||'Unknown error')+'</div>'));
    document.getElementById('state').textContent='—';
    return;
  }

  const a = data.address;
  document.getElementById('addr').textContent =
    a.city+', '+a.street+', '+a.house + (a.street_exact&&a.street_exact.toLowerCase()!==a.street.toLowerCase()?'  ('+a.street_exact+')':'');
  document.getElementById('updated').textContent =
    data.update_timestamp ? 'DTEK update: '+data.update_timestamp : '';
  document.getElementById('refMin').textContent = Math.round(REFRESH_MS/60000);

  const st = document.getElementById('state');
  const map = {on:'POWER ON', off:'POWER OFF', maybe:'POSSIBLE OUTAGE', unknown:'UNKNOWN'};
  const cls = data.excluded ? 'unknown' : data.current.state;
  setState(st, cls, data.excluded ? 'NOT IN SCHEDULE' : map[cls]);
  document.getElementById('stateSub').textContent = data.excluded
    ? 'Your address is not part of the outage schedule.'
    : ('Now: '+(data.current.range||data.current.slot||'—')+(data.current.until_hint?(' · change around '+data.current.until_hint):''));

  const badges = document.getElementById('badges');
  badges.innerHTML = '';
  if (data.group){
    badges.innerHTML += '<div><span class="badge">Group: <b>'+ (data.group_name||'') +'</b> ('+data.group+')</span></div>';
  }
  if ((data.groups||[]).length>1){
    badges.innerHTML += '<div><span class="badge">also: '+data.groups.slice(1).join(', ')+'</span></div>';
  }

  const oc = document.getElementById('outageCard');
  if (data.outage){
    oc.style.display='';
    let html = '<h2 style="color:var(--off)">Current outage at this address</h2><div>'+
      '<b>'+(data.outage.description||'Відключення')+'</b>';
    if (data.outage.start) html += ' · from '+data.outage.start;
    if (data.outage.end) html += ' · until '+data.outage.end;
    html += '</div>';
    if (data.outage.voluntarily) html += '<div class="small muted">Voluntary disconnection</div>';
    if (data.outage.external) html += '<div class="small muted">Fed by another operator (ЦЕК)</div>';
    oc.innerHTML = html;
  } else { oc.style.display='none'; }

  const srcNames = {fact:'confirmed (fact)', preset:'planned (weekly plan)', none:''};
  const today = document.getElementById('todayTl');
  today.innerHTML=''; renderSlots(data.today.slots, data.current.slot).forEach(e=>today.appendChild(e));
  const tr = document.getElementById('todayRuler'); tr.innerHTML='';
  renderRuler(data.today.slots).forEach(e=>tr.appendChild(e));
  document.getElementById('todaySrc').textContent = srcNames[data.today.source]||'';

  const tw = document.getElementById('todayWins'); tw.innerHTML='';
  (data.today.windows||[]).forEach(w=>{
    const li = document.createElement('li');
    li.innerHTML = '<span class="dot" style="background:'+COL[w.kind]+'"></span>'+
      (w.kind==='off'?'No power':'Possible outage')+': '+w.from+' – '+w.until;
    tw.appendChild(li);
  });

  const tcard = document.getElementById('tomorrowCard');
  if (data.tomorrow && data.tomorrow.slots.length){
    tcard.style.display='';
    const ttl = document.getElementById('tomorrowTl'); ttl.innerHTML='';
    renderSlots(data.tomorrow.slots, null).forEach(e=>ttl.appendChild(e));
    const ttr = document.getElementById('tomorrowRuler'); ttr.innerHTML='';
    renderRuler(data.tomorrow.slots).forEach(e=>ttr.appendChild(e));
    document.getElementById('tomorrowSrc').textContent = srcNames[data.tomorrow.source]||'';
  } else { tcard.style.display='none'; }

  const week = document.getElementById('week'); week.innerHTML='';
  data.week.forEach(day=>{
    const row = document.createElement('div'); row.className='weekrow';
    const nm = document.createElement('div'); nm.className='dayname';
    const dd = day.date.slice(8,10)+'.'+day.date.slice(5,7);
    nm.textContent = (day.name||'')+' '+dd;
    const tl = document.createElement('div'); tl.className='timeline';
    day.slots.forEach(s=>{
      const c = document.createElement('div'); c.className='cell';
      c.style.cssText = cellStyle(s.status);
      c.title = (day.name||day.date)+' '+(s.start||s.label)+' — '+gloss(s.status, data);
      tl.appendChild(c);
    });
    row.appendChild(nm); row.appendChild(tl); week.appendChild(row);
  });

  const legend = document.getElementById('legend'); legend.innerHTML='';
  const legendOrder = ['yes','no','maybe','first','second','mfirst','msecond'];
  legendOrder.forEach(s=>{
    const l = (data.legend||{})[s]; if(!l) return;
    const item = document.createElement('div'); item.className='item';
    const sw = document.createElement('span'); sw.className='sw';
    sw.style.cssText = cellStyle(s);
    item.appendChild(sw); item.appendChild(document.createTextNode(l.ua+' ('+l.en+')'));
    legend.appendChild(item);
  });

  document.getElementById('inCity').value = a.city;
  document.getElementById('inStreet').value = a.street;
  document.getElementById('inHouse').value = a.house;
}

async function fetchStatus(){
  try{
    const r = await fetch('/api/status');
    render(await r.json());
  }catch(err){
    console.error(err);
  }
}
async function doRefresh(){
  const btn = document.getElementById('btnRefresh');
  btn.disabled = true;
  try{ await fetch('/api/refresh', {method:'POST'}); }catch(e){}
  await fetchStatus();
  btn.disabled = false;
}
async function saveAddress(ev){
  ev.preventDefault();
  const body = {
    city: document.getElementById('inCity').value,
    street: document.getElementById('inStreet').value,
    house: document.getElementById('inHouse').value
  };
  const r = await fetch('/api/address', {method:'POST',
    headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  render(await r.json());
}
fetchStatus();
setInterval(fetchStatus, REFRESH_MS);
</script>
</body>
</html>
"""


def make_handler(service: ScheduleService, refresh_ms: int):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass  # keep the console quiet

        def _send(self, code: int, body: bytes, ctype: str):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                html = HTML_PAGE.replace("__REFRESH_MS__", str(refresh_ms))
                self._send(200, html.encode("utf-8"), "text/html; charset=utf-8")
            elif self.path == "/api/status":
                body = json.dumps(service.status(), ensure_ascii=False).encode("utf-8")
                self._send(200, body, "application/json; charset=utf-8")
            else:
                self._send(404, b"not found", "text/plain")

        def do_POST(self):
            length = int(self.headers.get("Content-Length") or 0)
            if self.path == "/api/refresh":
                body = json.dumps(service.refresh(force=True), ensure_ascii=False)
                self._send(200, body.encode("utf-8"), "application/json; charset=utf-8")
            elif self.path == "/api/address":
                try:
                    data = json.loads(self.rfile.read(length).decode("utf-8"))
                except ValueError:
                    self._send(400, b'{"ok":false,"error":"bad json"}', "application/json")
                    return
                old = {k: service.cfg.get(k) for k in ("city", "street", "house")}
                for key in ("city", "street", "house"):
                    if str(data.get(key, "")).strip():
                        service.cfg[key] = str(data[key]).strip()
                service._streets = None  # re-resolve street spelling
                result = service.refresh(force=True)
                if result.get("ok") and not result.get("stale"):
                    save_config(service.cfg)  # persist only addresses that resolve
                else:
                    service.cfg.update(old)   # revert on failure
                body = json.dumps(result, ensure_ascii=False)
                self._send(200, body.encode("utf-8"), "application/json; charset=utf-8")
            else:
                self._send(404, b"not found", "text/plain")

    return Handler


def run_web(cfg: dict, demo: bool, port: int, no_open: bool) -> None:
    service = ScheduleService(cfg, demo=demo)
    refresh_ms = max(60, int(cfg.get("refresh_minutes", 5))) * 60 * 1000

    server = None
    for candidate in range(port, port + 21):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", candidate), make_handler(service, refresh_ms))
            port = candidate
            break
        except OSError:
            continue
    if server is None:
        raise AppError(f"Could not bind any port from {port} to {port+20}.")

    url = f"http://127.0.0.1:{port}"
    print(f"DTEK Odesa shutdown app running at {url}  (Ctrl+C to stop)")
    threading.Thread(target=service.background_loop, args=(refresh_ms / 1000,), daemon=True).start()
    if not no_open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye!")
    finally:
        server.server_close()


# --------------------------------------------------------------------------
# CLI report
# --------------------------------------------------------------------------

def cli_report(cfg: dict, demo: bool) -> int:
    service = ScheduleService(cfg, demo=demo)
    data = service.refresh(force=True)
    if not data.get("ok"):
        print(f"error: {data.get('error', 'unknown')}")
        return 2

    a, cur = data["address"], data["current"]
    print("=" * 62)
    if data.get("stale"):
        print("  ! DTEK unreachable - showing last saved schedule !")
        print("    " + str(data.get("error", ""))[:100])
        print("=" * 62)
    print(f"  {a['city']}, {a['street']}, {a['house']}")
    if a.get("street_exact") and a["street_exact"] != a["street"]:
        print(f"  (DTEK spelling: {a['street_exact']})")
    if data.get("demo"):
        print("  *** DEMO MODE - sample data ***")
    print("=" * 62)
    if data.get("excluded"):
        print("  This address is NOT in the disconnection schedule.")
    else:
        label = {"on": "POWER ON", "off": "POWER OFF", "maybe": "POSSIBLE OUTAGE",
                 "unknown": "UNKNOWN"}[cur["state"]]
        print(f"  Now: {label}" + (f"  ({cur.get('range') or cur['slot']})" if cur["slot"] else ""))
        if data.get("group"):
            print(f"  Group: {data.get('group_name') or ''} ({data['group']})"
                  + (f"  also {', '.join(g for g in data['groups'] if g != data['group'])}"
                     if len(data.get("groups", [])) > 1 else ""))
        if data.get("next_event"):
            ne = data["next_event"]
            print(f"  Next: {'power off' if ne['state']=='off' else 'power on'} at {ne['at']}")

    if data.get("outage"):
        o = data["outage"]
        print(f"  ! Current outage: {o['description'] or 'Відключення'}"
              + (f"  {o['start']} → {o['end']}" if o["start"] else ""))

    def timeline(slots):
        chars = []
        for s in slots:
            for half in (False, True):
                st = half_state(s["status"], half)
                chars.append({"on": "\u00b7", "off": "\u2588", "maybe": "\u2592"}[st])
        return "".join(chars)

    def ruler(slots):
        parts = []
        for i in range(0, len(slots), 2):
            parts.append((slots[i]["start"] or slots[i]["label"])[:2].ljust(4))
        return "".join(parts)

    if data["today"]["slots"]:
        print(f"\n  Today ({data['today']['source']}):")
        print("   " + timeline(data["today"]["slots"]))
        print("   " + ruler(data["today"]["slots"]))
        for w in data["today"].get("windows", []):
            kind = "no power" if w["kind"] == "off" else "possible"
            print(f"     {kind}: {w['from']} - {w['until']}")
    if data["tomorrow"]["slots"]:
        print(f"\n  Tomorrow ({data['tomorrow']['source']}):")
        print("   " + timeline(data["tomorrow"]["slots"]))
        print("   " + ruler(data["tomorrow"]["slots"]))

    week = data.get("week") or []
    if any(d["slots"] for d in week):
        print("\n  Next 7 days (hours without power per day):")
        for d in week:
            if not d["slots"]:
                continue
            off = count_off_hours(d["slots"])
            if off:
                print(f"     {d['name'] or d['date']} ({d['date'][8:10]}.{d['date'][5:7]}): {off:g} h")
            else:
                print(f"     {d['name'] or d['date']} ({d['date'][8:10]}.{d['date'][5:7]}): -")

    stamp = data.get("update_timestamp") or data.get("update_fact")
    if stamp:
        print(f"\n  DTEK data updated: {stamp}")
    print(f"  Generated: {data['generated_at']} (Kyiv time)")
    return 0


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="DTEK Odesa shutdown schedule for a saved address.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--cli", action="store_true",
                        help="print the schedule once to the terminal and exit")
    parser.add_argument("--demo", action="store_true",
                        help="demo data (community mirror schedules + sample house)")
    parser.add_argument("--port", type=int, default=None, help="web app port")
    parser.add_argument("--no-open", action="store_true",
                        help="do not open the browser automatically")
    parser.add_argument("--city", help="override settlement (saved to config)")
    parser.add_argument("--street", help="override street (saved to config)")
    parser.add_argument("--house", help="override house number (saved to config)")
    args = parser.parse_args(argv)

    cfg = load_config()
    changed = False
    for key in ("city", "street", "house"):
        if getattr(args, key):
            cfg[key] = getattr(args, key).strip()
            changed = True
    if args.port:
        cfg["port"] = args.port
        changed = True
    if changed:
        save_config(cfg)

    try:
        if args.cli:
            return cli_report(cfg, demo=args.demo)
        run_web(cfg, demo=args.demo, port=int(cfg.get("port", 8787)),
                no_open=args.no_open)
        return 0
    except AppError as err:
        print(f"error: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())

