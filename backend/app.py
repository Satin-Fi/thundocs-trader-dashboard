#!/usr/bin/env python3
"""Paper Trader API - serves dashboard data + runs the demo paper-trader.
Stdlib only (no pip) so it deploys on Render's free tier without dependency issues.
Endpoints:
  GET /api/state   - live demo balance + bot P&L + equity curve + portfolio analytics
  GET /api/fills   - trade history (newest first)
  GET /           - optional: serve built frontend if present
Also launches the trading loop in a background thread (RSI 15m mean-reversion, demo only).
"""
import os, json, time, hmac, hashlib, datetime as dt, threading, urllib.request, urllib.parse, socket, sys
from http.server import HTTPServer, BaseHTTPRequestHandler

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
KEYFILE = os.path.join(HERE, "testnet_keys.json")
BASE = "https://demo-api.binance.com/api"
KL_INTERVAL = os.getenv("KL_INTERVAL", "15m")
LOOP_SECONDS = int(os.getenv("LOOP_SECONDS", "900"))
MAX_NOTIONAL = float(os.getenv("MAX_NOTIONAL", "25"))
SETTINGS_FILE = os.path.join(HERE, "settings.json")
def load_settings():
    d = {}
    try:
        d = json.load(open(SETTINGS_FILE))
    except Exception:
        pass
    max_cap = float(d.get("max_capital", os.getenv("MAX_CAPITAL", str(MAX_NOTIONAL))))
    sym = d.get("symbol", os.getenv("SYMBOL", "BTCUSDT")).upper()
    manual = d.get("manual", {})
    return max_cap, sym, manual

MAX_CAPITAL, SYMBOL, MANUAL_STATE = load_settings()

def get_fill_log():
    return os.path.join(HERE, "fills.jsonl")
RSI_LOW, RSI_HIGH = 45, 55   # RSI_LOW = entry RSI ceiling; RSI_HIGH = neutral exit RSI (mean-reversion target)
# Risk / execution controls (all env-overridable, safe defaults)
SL_PCT = float(os.getenv("SL_PCT", "0.03"))      # 3% hard stop-loss
TP_PCT = float(os.getenv("TP_PCT", "0.05"))       # 5% take-profit (fallback when no S/R)
SL_CAP = float(os.getenv("SL_CAP", "0.05"))       # max SL distance from entry (structure-aware)
TP_CAP = float(os.getenv("TP_CAP", "0.05"))       # max TP distance from entry (structure-aware)
MAX_HOLD = int(os.getenv("MAX_HOLD_CANDLES", "12"))  # time-stop: ~3h at 15m
SMA_PERIOD = int(os.getenv("SMA_PERIOD", "50"))   # trend filter
KL_LIMIT = int(os.getenv("KL_LIMIT", "60"))       # candles fetched per tick
SIZE_MIN = 10.0                                    # min notional to trade
DUST = 0.00002                                     # BTC below this is dust: treat as flat
PORT = int(os.getenv("PORT", "8000"))

def log(m):
    print(f"{dt.datetime.now().isoformat()} | {m}", flush=True)

# Cached symbol lot filter (fetched once) so we can snap order qty to step size
# and enforce minQty — prevents Binance -1013 "Invalid quantity" rejections.
_LOT_STEP = None
def lot_step():
    global _LOT_STEP
    if _LOT_STEP is not None:
        return _LOT_STEP
    try:
        ei = demo_get("/exchangeInfo", {"symbol": SYMBOL})
        if isinstance(ei, dict) and ei.get("symbols"):
            for f in ei["symbols"][0]["filters"]:
                if f["filterType"] == "LOT_SIZE":
                    _LOT_STEP = float(f["stepSize"]) or 1e-5
                    return _LOT_STEP
    except Exception:
        pass
    _LOT_STEP = 1e-5
    return _LOT_STEP

def fmt_qty(qty):
    """Snap a desired quantity DOWN to the lot step size and enforce minQty."""
    step = lot_step()
    q = max(step, (qty // step) * step)
    # trim to 8 decimals to avoid float noise
    return round(q, 8)

def creds():
    # Prefer env vars (Render/deploy), fall back to local keyfile
    key = os.getenv("THUNDOC_BINANCE_KEY")
    secret = os.getenv("THUNDOC_BINANCE_SECRET")
    if key and secret:
        return {"apiKey": key, "secretKey": secret}
    if os.path.exists(KEYFILE):
        try: return json.load(open(KEYFILE))
        except Exception: return {}
    return {}

def demo_get(path, params=None):
    url = f"{BASE}/v3{path}" + (("?"+urllib.parse.urlencode(params)) if params else "")
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        log(f"DEMO_GET FAIL {path}: {e}")
        return {}

def demo_price():
    """BTCUSDT price from Binance DEMO (preferred). Falls back to CoinGecko
    public API if the demo endpoint is unreachable (e.g. blocked on some hosts)."""
    d = demo_get("/ticker/price", {"symbol": SYMBOL})
    p = float(d.get("price", 0) or 0)
    if p > 0:
        return p
    # fallback: CoinGecko (no key, reachable from most hosts)
    try:
        url = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
        with urllib.request.urlopen(url, timeout=10) as r:
            j = json.loads(r.read().decode())
            return float(j["bitcoin"]["usd"])
    except Exception as e:
        log(f"FALLBACK PRICE FAIL: {e}")
        return 0.0

# ---- cached live price (shared by /api/price, /api/stream, make_state) ----
_price_cache = {"price": 0.0, "ts": 0.0}
def live_price():
    """Return cached price if fresh (<250ms), else refetch. Avoids hammering
    Binance on every request (SSE streams many times/sec)."""
    now = time.time()
    if now - _price_cache["ts"] < 0.25 and _price_cache["price"] > 0:
        return _price_cache["price"]
    p = demo_price()
    if p > 0:
        _price_cache["price"] = p
        _price_cache["ts"] = now
    return _price_cache["price"]

def signed(path, params, method="GET"):
    c = creds()
    if not c.get("apiKey"):
        log("NO CREDENTIALS - set THUNDOC_BINANCE_KEY / THUNDOC_BINANCE_SECRET")
        return {}
    params = dict(params or {})
    params["timestamp"] = int(time.time()*1000); params["recvWindow"] = 5000
    q = "&".join(f"{k}={v}" for k, v in params.items())
    sig = hmac.new(c["secretKey"].encode(), q.encode(), hashlib.sha256).hexdigest()
    url = f"{BASE}/v3{path}"
    if method == "POST":
        # Binance requires POST params in the request BODY (not the query string).
        # The signature must cover the body params.
        body = f"{q}&signature={sig}".encode()
        req = urllib.request.Request(url, data=body, headers={"X-MBX-APIKEY": c["apiKey"]}, method="POST")
    else:
        req = urllib.request.Request(f"{url}?{q}&signature={sig}", headers={"X-MBX-APIKEY": c["apiKey"]})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        log(f"SIGNED FAIL {path}: {e}")
        return {}

def rsi(closes, period=14):
    g=[]; l=[]
    for i in range(1,len(closes)):
        d=closes[i]-closes[i-1]; g.append(max(d,0)); l.append(max(-d,0))
    if len(g) < period: return 50.0
    ag=sum(g[-period:])/period; al=sum(l[-period:])/period
    if al==0: return 100.0
    return 100-(100/(1+ag/al))

def sma(closes, n):
    if len(closes) < n: return closes[-1] if closes else 0.0
    return sum(closes[-n:]) / n

def last_buy(fills):
    for f in reversed(fills):
        if f.get("side") == "BUY":
            return f
    return None


def _interval_minutes():
    s = KL_INTERVAL
    return int(s[:-1]) if s[:-1].isdigit() else 15

def adaptive_entry(closes, i, ceil):
    """Regime-adaptive entry: RSI turning up (rp<=r) while in the low band
    (r < ceil) OR within a few points of its recent low. Works in ranges AND
    trends. `ceil` is the entry RSI ceiling (tuned by the self-tuner)."""
    r = rsi(closes[:i+1]); rp = rsi(closes[:i])
    if r < ceil and rp <= r:
        return True
    lo = max(1, i - 49)
    recent = [rsi(closes[max(0, j-13):j+1]) for j in range(lo, i+1)]
    if len(recent) >= 10 and rp <= r and r <= min(recent) + 3.0:
        return True
    return False

def ema(closes, n):
    if not closes: return 0.0
    k = 2.0 / (n + 1)
    e = closes[0]
    for p in closes[1:]:
        e = p * k + e * (1 - k)
    return e

def macd(closes, fast=12, slow=26, sig=9):
    """Returns (macd_line, signal_line, histogram) at the latest bar."""
    if len(closes) < slow + sig:
        return (0.0, 0.0, 0.0)
    kf, ks = 2.0/(fast+1), 2.0/(slow+1)
    ef = es = closes[0]; ef_s, es_s = [], []
    for p in closes:
        ef = p*kf + ef*(1-kf); es = p*ks + es*(1-ks)
        ef_s.append(ef); es_s.append(es)
    line = [a - b for a, b in zip(ef_s, es_s)]
    signal = ema(line, sig)
    return (line[-1], signal, line[-1] - signal)

def vol_avg(vols, n):
    v = vols[-n:] if len(vols) >= n else vols
    return sum(v) / len(v) if v else 0.0

def ema_series(vals, nn):
    out = []
    if not vals:
        return out
    k = 2.0 / (nn + 1)
    e = vals[0]
    for p in vals:
        e = p * k + e * (1 - k)
        out.append(e)
    return out

def sr_zones(highs, lows, closes, vols, swing=5, merge_pct=0.4, top_n=6):
    """Support/Resistance zones from the bot's own analysis of the candles.

    Method: find swing highs/lows (pivots) using a window, then cluster nearby
    pivots into zones (within `merge_pct`), score by how many pivots + volume
    confirm the level, and return the strongest `top_n` zones.
    Returns a list of {level, type ('S'|'R'), strength, touches} sorted by strength.
    """
    n = len(closes)
    if n < 2 * swing + 1:
        return []
    pivots = []  # (price, 'R'|'S', vol, idx)
    for i in range(swing, n - swing):
        hi = highs[i]; lo = lows[i]
        is_h = all(highs[j] <= hi for j in range(i - swing, i + swing + 1))
        is_l = all(lows[j] >= lo for j in range(i - swing, i + swing + 1))
        if is_h:
            pivots.append((hi, 'R', vols[i] if i < len(vols) else 0.0, i))
        if is_l:
            pivots.append((lo, 'S', vols[i] if i < len(vols) else 0.0, i))
    if not pivots:
        return []
    # cluster: greedy merge of pivots within merge_pct of a zone anchor
    clusters = []  # {type, level, vol, touches, idxs}
    for price, typ, vol, idx in sorted(pivots, key=lambda x: -x[0]):
        placed = False
        for c in clusters:
            if c['type'] == typ and abs(price - c['level']) / c['level'] <= merge_pct / 100.0:
                # weighted update toward the new pivot
                c['touches'] += 1
                c['vol'] += vol
                c['level'] = (c['level'] * (c['touches'] - 1) + price) / c['touches']
                placed = True
                break
        if not placed:
            clusters.append({'type': typ, 'level': price, 'vol': vol, 'touches': 1, 'idxs': [idx]})
    # strength: touches (recurrence) * volume, normalized
    maxvol = max((c['vol'] for c in clusters), default=1.0) or 1.0
    for c in clusters:
        c['strength'] = round(c['touches'] * (0.5 + 0.5 * c['vol'] / maxvol), 2)
    clusters.sort(key=lambda c: -c['strength'])
    return [
        {"level": round(c['level'], 2), "type": c['type'], "strength": c['strength'], "touches": c['touches']}
        for c in clusters[:top_n]
    ]


def atr(highs, lows, closes, n=14):
    """Average True Range — measures volatility. Used for ATR-based stops."""
    m = min(len(closes), len(highs), len(lows))
    if m < n + 1:
        # fallback: simple range of recent closes
        if m < 2:
            return 0.0
        return (max(closes[-n:]) - min(closes[-n:])) / max(closes[-1], 1e-9)
    trs = []
    for i in range(1, m):
        h, l, pc = highs[i], lows[i], closes[i - 1]
        tr = max(h - l, abs(h - pc), abs(l - pc))
        trs.append(tr)
    if len(trs) < n:
        return sum(trs) / len(trs) if trs else 0.0
    # Wilder smoothing
    a = sum(trs[:n]) / n
    for v in trs[n:]:
        a = (a * (n - 1) + v) / n
    return a


def regime(closes, highs=None, lows=None, n=20):
    """Classify market regime to gate strategy selection.
    Returns (label, score) where label in {trending, ranging, choppy}.
    - trending: strong directional move (ADX-like) + Bollinger bandwidth high
    - ranging:   low bandwidth, price oscillating
    - choppy:    very low directional strength and low bandwidth
    """
    m = len(closes)
    if m < n * 2:
        return ("ranging", 0.0)
    # directional strength: compare net displacement to realized volatility
    window = closes[-n * 2:]
    disp = abs(window[-1] - window[0]) / max(window[0], 1e-9)
    avg_step = 0.0
    for i in range(1, len(window)):
        avg_step += abs(window[i] - window[i - 1]) / max(window[i - 1], 1e-9)
    avg_step /= (len(window) - 1)
    dir_strength = disp / max(avg_step * n, 1e-9)  # >1 means net move dominates noise
    # Bollinger bandwidth (recent n)
    rc = closes[-n:]
    mean = sum(rc) / n
    var = sum((x - mean) ** 2 for x in rc) / n
    sd = var ** 0.5
    bandwidth = (2 * sd) / max(mean, 1e-9)
    if dir_strength > 1.6 and bandwidth > 0.025:
        return ("trending", round(dir_strength, 2))
    if bandwidth < 0.015:
        return ("choppy", round(dir_strength, 2))
    return ("ranging", round(dir_strength, 2))


# Trailing stop state (only meaningful while a position is open). Updated in tick().
_trail_stop = None  # price level; None when flat


def trailing_stop_update(entry, entry_atr, px):
    """Maintain a trailing stop once in profit. Locks in gains:
    - arm only when price is >= entry + 1.0*ATR (i.e. in profit beyond noise)
    - then keep stop at max(prev_stop, px - 1.0*ATR) but never below entry.
    Returns the current stop price (or None if not yet armed)."""
    global _trail_stop
    if entry_atr <= 0:
        return _trail_stop
    if _trail_stop is None:
        if px >= entry + entry_atr:  # in profit beyond one ATR of noise
            _trail_stop = max(entry, px - entry_atr)
    else:
        # raise the stop as price climbs, never below entry
        _trail_stop = max(_trail_stop, px - entry_atr, entry)
    return _trail_stop


def trailing_stop_reset():
    global _trail_stop
    _trail_stop = None


def compute_indicators(interval=KL_INTERVAL, limit=300):
    """Compute the indicator series the dashboard overlays on the chart, using
    the SAME math the bot's strategy uses (rsi/ema/macd/breakout). Returns a
    dict of aligned time-series (timestamps + values) plus the live signal."""
    try:
        kl = demo_get("/klines", {"symbol": SYMBOL, "interval": interval, "limit": limit})
    except Exception:
        kl = None
    if not isinstance(kl, list) or len(kl) < 15:
        return {"error": "klines unavailable", "interval": interval}
    times = [int(k[0]) // 1000 for k in kl]
    opens = [float(k[1]) for k in kl]
    highs = [float(k[2]) for k in kl]
    lows  = [float(k[3]) for k in kl]
    closes = [float(k[4]) for k in kl]
    vols = [float(k[5]) for k in kl]
    n = len(closes)

    # RSI (Wilder-ish, same as bot's rsi())
    rsi_arr = []
    g = [0.0]; l = [0.0]
    for i in range(1, n):
        d = closes[i] - closes[i - 1]
        g.append(max(d, 0)); l.append(max(-d, 0))
    for i in range(n):
        if i < 14:
            rsi_arr.append(None)
        else:
            ag = sum(g[i - 13:i + 1]) / 14.0
            al = sum(l[i - 13:i + 1]) / 14.0
            rsi_arr.append(100.0 if al == 0 else 100 - (100 / (1 + ag / al)))

    # EMAs
    def ema_series(vals, nn):
        out = []
        if not vals: return out
        k = 2.0 / (nn + 1)
        e = vals[0]
        for p in vals:
            e = p * k + e * (1 - k)
            out.append(e)
        return out
    ema20 = ema_series(closes, 20)
    ema50 = ema_series(closes, 50)

    # MACD
    def macd_series(vals, fast=12, slow=26, sig=9):
        kf, ks = 2.0 / (fast + 1), 2.0 / (slow + 1)
        ef = vals[0]; es = vals[0]
        ef_s, es_s = [], []
        for p in vals:
            ef = p * kf + ef * (1 - kf); es = p * ks + es * (1 - ks)
            ef_s.append(ef); es_s.append(es)
        line = [a - b for a, b in zip(ef_s, es_s)]
        sig_s = ema_series(line, sig)
        hist = [a - b for a, b in zip(line, sig_s)]
        return line, sig_s, hist
    macd_line, macd_sig, macd_hist = macd_series(closes)

    # Breakout bands (donchian-style, same lookback the bot uses)
    lb = BREAKOUT_PARAMS.get("lookback", 20)
    upper, lower = [], []
    for i in range(n):
        if i < lb:
            upper.append(None); lower.append(None)
        else:
            upper.append(max(highs[i - lb:i])); lower.append(min(lows[i - lb:i]))

    # Support / Resistance zones (bot's own pivot+volume analysis)
    sr = sr_zones(highs, lows, closes, vols)

    # Live signal from the active strategy (so the dashboard shows WHY HOLD/BUY/SELL)
    sig = "HOLD"; reason = ""
    try:
        # Derive flat/holding from the LOCAL fills ledger (no slow signed /account
        # call) so this endpoint stays fast on every chart refresh.
        _fills = load_fills()
        _open = 0.0
        for f in reversed(_fills):
            if f["side"] == "BUY":
                _open = float(f["qty"]); break
            else:
                _open = 0.0; break
        # regime + ATR for the live signal context
        _reg, _rs = regime(closes, highs, lows)
        _a = atr(highs, lows, closes, 14)
        s, r = gen_signal(closes, vols, n - 1, (1 if _open > DUST else 0),
                          closes[-1], 0, STRATEGY_PARAMS, STRATEGY, sr,
                          atr_val=_a, regime_label=_reg)
        sig, reason = s, r
    except Exception as e:
        sig, reason = "HOLD", f"err {e}"

    return {
        "interval": interval,
        "times": times,
        "rsi": rsi_arr,
        "ema20": ema20,
        "ema50": ema50,
        "macd_line": macd_line,
        "macd_signal": macd_sig,
        "macd_hist": macd_hist,
        "breakout_upper": upper,
        "breakout_lower": lower,
        "sr_zones": sr,
        "signal": sig,
        "signal_reason": reason,
        "strategy": STRATEGY,
        "strategy_params": STRATEGY_PARAMS,
        "regime": _reg,
        "regime_score": _rs,
        "atr": round(_a, 2),
    }

# In-memory cache so the (klines + signal) computation only runs occasionally;
# repeated chart refreshes / toggle flips return instantly.
_IND_CACHE = {}  # interval -> (ts, result)
_IND_TTL = 30.0
def compute_indicators_cached(interval=KL_INTERVAL, limit=300):
    now = time.time()
    hit = _IND_CACHE.get(interval)
    if hit and (now - hit[0]) < _IND_TTL:
        return hit[1]
    res = compute_indicators(interval, limit)
    _IND_CACHE[interval] = (now, res)
    return res

def btc_open_for_signal():
    try:
        acc = signed("/account", {})
        if isinstance(acc, dict):
            for b in acc.get("balances", []):
                if b["asset"] == "BTC":
                    return float(b["free"])
    except Exception:
        pass
    return 0.0

# --- Strategy library (selectable from the dashboard) ---
# Each strategy: human name, description, default params, and the logic lives in
# gen_signal() (keyed by `strategy`). SL/TP are still shared hard stops, but the
# reversion TP is now structure-aware (nearest resistance) so the plotted target
# is honest about where the bot intends to exit.
STRATEGY_LIB = {
    "reversion": {
        "name": "RSI Reversion",
        "desc": "Buys when RSI dips into the low band and turns up; exits when RSI recovers. Small, frequent wins in ranging markets.",
        "params": {"entry_ceil": 45, "exit_rsi": 55},
    },
    "breakout": {
        "name": "Donchian Breakout",
        "desc": "Buys when price breaks above the N-bar high with volume + MACD confirmation; exits on breakdown. Catches trend moves.",
        "params": {"lookback": 20, "vol_mult": 1.5},
    },
    "ema_trend": {
        "name": "EMA Trend",
        "desc": "Buys when price is above EMA50 and EMA20 crosses above EMA50 (golden cross); exits on death cross / close below EMA50. Trend-following.",
        "params": {"fast": 20, "slow": 50},
    },
    "sr_bounce": {
        "name": "S/R Bounce",
        "desc": "Buys near a detected support zone with RSI turning up; targets the nearest resistance. Structure-based mean reversion.",
        "params": {"entry_ceil": 45, "exit_rsi": 55, "zone_pct": 0.4},
    },
}
STRATEGY_FILE = os.path.join(HERE, "strategy.json")
# Breakout params kept as a convenience alias (single source = STRATEGY_LIB).
BREAKOUT_PARAMS = STRATEGY_LIB["breakout"]["params"]

def _load_strategy():
    global STRATEGY, STRATEGY_PARAMS
    key = os.getenv("STRATEGY", "reversion")
    if os.path.exists(STRATEGY_FILE):
        try:
            d = json.load(open(STRATEGY_FILE))
            if d.get("strategy") in STRATEGY_LIB:
                key = d["strategy"]
        except Exception:
            pass
    STRATEGY = key
    STRATEGY_PARAMS = dict(STRATEGY_LIB[key]["params"])

_load_strategy()

def set_strategy(key):
    """Switch the active strategy (validates, persists to strategy.json, updates params)."""
    global STRATEGY, STRATEGY_PARAMS
    if key not in STRATEGY_LIB:
        return False
    STRATEGY = key
    STRATEGY_PARAMS = dict(STRATEGY_LIB[key]["params"])
    try:
        json.dump({"strategy": key}, open(STRATEGY_FILE, "w"))
    except Exception:
        pass
    log(f"STRATEGY SWITCHED -> {key}")
    return True

def get_strategy_key():
    return STRATEGY
def gen_signal(closes, vols, i, position, entry, held, p, strategy, sr_zones=None, atr_val=None, regime_label=None):
    """Unified entry/exit signal for a given strategy.
    Returns ("BUY"|"SELL"|"HOLD", reason).
    Phase-3 upgrades: regime gating, volume confirmation, ATR-based stops,
    and a trailing stop (via module-level _trail_stop, armed in tick()).
    `sr_zones` feeds structure-based strategies (sr_bounce).
    `atr_val` is the current ATR (set in tick) used for volatility stops.
    `regime_label` ("trending"/"ranging"/"choppy") gates mean-reversion vs trend."""
    px = closes[i]
    # --- ENTRY gating by regime ---
    # Mean-reversion strategies (reversion, sr_bounce) need a NON-trending market.
    # Trend strategies (breakout, ema_trend) need a trending market.
    if position == 0:
        mean_rev = strategy in ("reversion", "sr_bounce")
        trend = strategy in ("breakout", "ema_trend")
        if mean_rev and regime_label == "trending":
            return ("HOLD", "regime trending — reversion paused")
        if trend and regime_label == "choppy":
            return ("HOLD", "regime choppy — trend paused")
        # volume confirmation helper
        vol_ok = True
        if vols is not None and i < len(vols):
            lb = p.get("lookback", 20) if strategy == "breakout" else 20
            vol_ok = vols[i] > vol_avg(vols, lb) * p.get("vol_mult", 1.3)
        if strategy == "reversion":
            r = rsi(closes[:i+1]); rp = rsi(closes[:i])
            if r < p["entry_ceil"] and rp <= r and vol_ok:
                return ("BUY", f"RSI {r:.0f} turn-up")
            lo = max(1, i-49)
            recent = [rsi(closes[max(0, j-13):j+1]) for j in range(lo, i+1)]
            if len(recent) >= 10 and rp <= r and r <= min(recent) + 3.0 and vol_ok:
                return ("BUY", f"RSI near-low {r:.0f}")
            return ("HOLD", f"RSI {rsi(closes[:i+1]):.0f}")
        elif strategy == "ema_trend":
            f_, s_ = p.get("fast", 20), p.get("slow", 50)
            if i < s_:
                return ("HOLD", "warmup")
            ema_f = ema_series(closes[:i+1], f_); ema_s = ema_series(closes[:i+1], s_)
            if ema_f[-1] > ema_s[-1] and ema_f[-2] <= ema_s[-2] and px > ema_s[-1]:
                return ("BUY", f"EMA golden cross {ema_f[-1]:.0f}>{ema_s[-1]:.0f}")
            return ("HOLD", "below EMA trend")
        elif strategy == "sr_bounce":
            if not sr_zones:
                return ("HOLD", "no S/R yet")
            sup = max((z["level"] for z in sr_zones if z["type"] == "S" and z["level"] <= px * 1.002), default=None)
            r = rsi(closes[:i+1]); rp = rsi(closes[:i])
            if sup and abs(px - sup) / sup <= p.get("zone_pct", 0.4)/100.0 and r < p["entry_ceil"] and rp <= r and vol_ok:
                return ("BUY", f"S/R bounce {sup:.0f} RSI {r:.0f}")
            return ("HOLD", f"RSI {r:.0f} no support")
        else:  # breakout / momentum
            lb = p.get("lookback", 20)
            if i < lb:
                return ("HOLD", "warmup")
            hi = max(closes[i-lb:i]); mh, ms, mhst = macd(closes[:i+1])
            mhst_prev = macd(closes[:i])[2]
            if px > hi and mhst > 0 and mhst >= mhst_prev and vol_ok:
                return ("BUY", f"breakout>{hi:.0f} vol")
            return ("HOLD", "no breakout")
    else:  # holding -> exit logic
        # Trailing stop (armed in tick) takes priority once in profit.
        if _trail_stop is not None and px <= _trail_stop:
            return ("SELL", f"TRAIL {_trail_stop:.0f} (locked gain)")
        # ATR-based hard stops (fall back to % if ATR unknown)
        if atr_val and atr_val > 0:
            sl = entry - 1.5 * atr_val
            tp = entry + 2.0 * atr_val
        else:
            sl = entry * (1 - SL_PCT)
            tp = entry * (1 + TP_PCT)
        if px <= sl:
            return ("SELL", f"STOP -{(1-px/entry)*100:.1f}%")
        if px >= tp:
            return ("SELL", f"TP +{(px/entry-1)*100:.1f}%")
        if held >= MAX_HOLD:
            return ("SELL", f"TIME-STOP {held}c")
        if strategy in ("reversion", "sr_bounce"):
            if rsi(closes[:i+1]) >= p["exit_rsi"]:
                return ("SELL", f"RSI>={p['exit_rsi']}")
        elif strategy == "sr_bounce":
            res = min((z["level"] for z in sr_zones if z["type"] == "R" and z["level"] >= entry), default=None)
            if res and px >= res * 0.999:
                return ("SELL", f"hit resistance {res:.0f}")
        elif strategy == "ema_trend":
            f_, s_ = p.get("fast", 20), p.get("slow", 50)
            if i < s_:
                return ("HOLD", "warmup")
            ema_f = ema_series(closes[:i+1], f_); ema_s = ema_series(closes[:i+1], s_)
            if ema_f[-1] < ema_s[-1] and ema_f[-2] >= ema_s[-2]:
                return ("SELL", "EMA death cross")
            if px < ema_s[-1]:
                return ("SELL", f"below EMA50 {ema_s[-1]:.0f}")
        else:  # breakout
            lb = p.get("lookback", 20)
            if i >= lb and px < min(closes[i-lb:i]):
                return ("SELL", "breakdown")
            if macd(closes[:i+1])[2] < 0:
                return ("SELL", "MACD neg")
        return ("HOLD", f"hold {(px/entry-1)*100:+.1f}%")

def record_fill(side, qty, price, oid, actor="bot", symbol=None):
    # actor: "bot" (automated) or "user" (manual trade placed by the user).
    sym = symbol or SYMBOL
    with open(get_fill_log(), "a") as f:
        f.write(json.dumps({"t": dt.datetime.now().isoformat(), "symbol": sym, "side": side, "qty": qty,
                            "price": price, "order": oid, "actor": actor}) + "\n")

def record_manual(side, qty, price, symbol=None):
    """Persist a manual (user-placed) order to the shared ledger, tagged actor=user."""
    oid = f"manual-{int(time.time()*1000)}"
    record_fill(side, qty, price, oid, actor="user", symbol=symbol)
    return oid

# last realized exit (reason + price + ts) — surfaced on the dashboard so the
# user can see WHY the bot closed the previous trade (RSI / TP / SL / time-stop).
# last AI second-opinion verdict (surfaced on dashboard + used to gate entries)
_last_ai = None
def set_last_ai(v):
    global _last_ai
    _last_ai = v
def get_last_ai():
    return _last_ai

def _safe_ai(signal, ctx, timeout=18):
    """Call the free AI verdict without ever blocking the dashboard/loop.
    Runs in a worker thread; returns a graceful default on timeout."""
    import threading
    box = {}
    def runner():
        try:
            from ai_provider import ai_verdict
            box["v"] = ai_verdict(signal, ctx)
        except Exception as e:
            box["v"] = {"verdict": "CONFIRM", "reason": f"ai error: {e}",
                        "provider": "error", "model": "none",
                        "ts": dt.datetime.now().isoformat(), "signal": signal}
    t = threading.Thread(target=runner, daemon=True)
    t.start()
    t.join(timeout)
    if "v" in box:
        return box["v"]
    return {"verdict": "PENDING", "reason": "ai timeout (using technical signal)",
            "provider": "timeout", "model": "none",
            "ts": dt.datetime.now().isoformat(), "signal": signal}

_last_exit = None
def _record_exit(reason, price):
    global _last_exit
    _last_exit = {"reason": reason, "price": round(price, 2), "t": dt.datetime.now().isoformat()}

def load_fills():
    out=[]
    fl = get_fill_log()
    if os.path.exists(fl):
        for ln in open(fl):
            try: out.append(json.loads(ln))
            except Exception: continue
    return out

def load_tune():
    try:
        if os.path.exists(TUNE_FILE):
            return json.load(open(TUNE_FILE))
    except Exception:
        pass
    return None


def tick():
    c = creds()
    has_keys = bool(c.get("apiKey"))
    try:
        _fills = load_fills()
        balances = {}
        for f in _fills:
            sym = f.get("symbol", SYMBOL)
            q = float(f["qty"])
            if f["side"] == "BUY": balances[sym] = balances.get(sym, 0.0) + q
            else: balances[sym] = balances.get(sym, 0.0) - q
        
        open_symbols = [s for s, q in balances.items() if q > DUST]
        active_symbols = list(set(open_symbols + [SYMBOL]))
        prices = get_all_prices()
        
        for sym in active_symbols:
            price = prices.get(sym)
            if not price:
                url = f"https://api.binance.com/api/v3/ticker/price?symbol={sym}"
                try:
                    with urllib.request.urlopen(urllib.request.Request(url), timeout=5) as r:
                        price = float(json.loads(r.read().decode()).get("price", 0))
                except: continue
            if price == 0: continue
            
            kl = demo_get("/klines", {"symbol": sym, "interval": KL_INTERVAL, "limit": KL_LIMIT})
            if not isinstance(kl, list) or len(kl) < 15: continue
            closes = [float(k[4]) for k in kl]
            vols = [float(k[5]) for k in kl]
            highs = [float(k[2]) for k in kl]
            lows = [float(k[3]) for k in kl]
            sr = sr_zones(highs, lows, closes, vols)
            cur_atr = atr(highs, lows, closes, 14)
            reg_label, reg_score = regime(closes, highs, lows)
            
            qty_held = balances.get(sym, 0.0)
            
            # Global cash wallet balance calculation (starting 10,000 USDT deposit)
            cash = 10000.0
            for f in _fills:
                if f["side"] == "BUY": cash -= float(f["qty"]) * float(f["price"])
                else: cash += float(f["qty"]) * float(f["price"])
            
            p = STRATEGY_PARAMS
            if qty_held < DUST:
                if sym != SYMBOL: continue # Only hunt for entries on chart symbol

                # ── TradingAgents LLM Brain (primary signal) ───────────────────────
                ta_sig, ta_reason = "UNKNOWN", ""
                try:
                    from ta_engine import get_ta_verdict
                    tv = get_ta_verdict()
                    if tv and tv.get("signal"):
                        ta_sig    = tv["signal"]          # BUY / SELL / HOLD
                        ta_reason = (f"TA({tv.get('deep_model','?')}) "
                                     f"rating={tv.get('rating',0)}/5 — "
                                     f"{tv.get('reasoning','')[:120]}")
                        log(f"TA verdict: {ta_sig} (rating {tv.get('rating',0)}/5)")
                except Exception as _te:
                    log(f"TA verdict read error: {_te}")

                # ── Rule-based fallback (always computed for comparison) ────────────
                sig, reason = gen_signal(closes, vols, len(closes)-1, 0, 0, 0.0, 0, p, STRATEGY, sr, atr_val=cur_atr, regime_label=reg_label)
                trailing_stop_reset()

                # ── Signal decision logic ──────────────────────────────────────────
                if ta_sig == "BUY":
                    # TA says BUY → override rule-based, proceed to entry
                    sig = "BUY"
                    reason = f"TA-BRAIN: {ta_reason}"
                elif ta_sig == "SELL":
                    # TA says SELL → stay flat (don't enter)
                    sig = "HOLD"
                    reason = f"TA-BRAIN blocked entry (bearish): {ta_reason[:80]}"
                elif ta_sig == "HOLD":
                    # TA says HOLD → only enter if rule-based also says BUY (confluence)
                    if sig != "BUY":
                        reason = f"TA-BRAIN: HOLD, rule-based: {reason}"
                    else:
                        reason = f"Confluence BUY — TA:HOLD rule:{reason}"
                else:
                    # TA unavailable — fall through to pure rule-based
                    pass

                if sig == "BUY" and cash >= SIZE_MIN:
                    # --- FREE AI SECOND OPINION before risking capital ---
                    try:
                        from ai_provider import ai_verdict
                        ai = ai_verdict("BUY", {"symbol": sym, "position": "flat",
                            "rsi": rsi(closes), "regime": reg_label, "price": price,
                            "support": sr[1] if sr else None, "resistance": sr[0] if sr else None,
                            "strategy": STRATEGY})
                        if ai["verdict"] == "REJECT":
                            log(f"AI({ai['provider']}) REJECTED BUY {sym}: {ai['reason']}")
                            sig = "HOLD"; reason = f"AI rejected: {ai['reason']}"
                            set_last_ai(ai)
                        else:
                            set_last_ai(ai)
                    except Exception as e:
                        log(f"ai_verdict skipped: {e}")
                    # ---------------------------------------------------------
                    notional = min(float(MAX_CAPITAL), max(10.0, cash * 0.95))
                    if notional >= SIZE_MIN:
                        qty = round(notional / price, 6)
                        if has_keys:
                            o = signed("/order", {"symbol":sym,"side":"BUY","type":"MARKET", "quoteOrderQty": round(notional, 2)}, "POST")
                            if isinstance(o, dict) and o.get("orderId"):
                                ex = (o.get("fills") or [{}])[0]
                                fill_px = float(ex.get("price", price))
                                record_fill("BUY", fmt_qty(float(ex.get("qty", qty))), fill_px, o["orderId"], actor="bot", symbol=sym)
                                log(f"BOT BUY {sym} @ {fill_px} ({reason})")
                        else:
                            # Paper trading fill
                            oid = f"paper-bot-{int(time.time()*1000)}"
                            record_fill("BUY", qty, price, oid, actor="bot", symbol=sym)
                            log(f"BOT PAPER BUY {sym} {qty} @ {price:.2f} ({reason})")

            else:
                f_sym = [f for f in _fills if f.get("symbol", SYMBOL) == sym]
                fb = [f for f in f_sym if f["side"] == "BUY"]
                fb = fb[-1] if fb else None
                entry = float(fb["price"]) if fb else price
                held = int((dt.datetime.now() - dt.datetime.fromisoformat(fb["t"])).total_seconds()/60/_interval_minutes()) if fb else 0
                
                sig, reason = "HOLD", ""
                m_state = MANUAL_STATE.get(sym, {})
                sl = m_state.get("sl")
                tp = m_state.get("tp")
                auto = m_state.get("auto_manage", True)

                if sl and price <= float(sl):
                    sig, reason = "SELL", f"Stop Loss Hit @ ${price:.2f} (Target SL: ${float(sl):.2f})"
                elif tp and price >= float(tp):
                    sig, reason = "SELL", f"Take Profit Hit @ ${price:.2f} (Target TP: ${float(tp):.2f})"
                elif auto:
                    trailing_stop_update(entry, cur_atr, price)
                    sig, reason = gen_signal(closes, vols, len(closes)-1, 1, entry, held, p, STRATEGY, sr, atr_val=cur_atr, regime_label=reg_label)
                    # ── TA exit override: if TA says SELL and rating is very bearish ──
                    if sig == "HOLD":
                        try:
                            from ta_engine import get_ta_verdict
                            tv = get_ta_verdict()
                            if tv and tv.get("signal") == "SELL" and tv.get("rating", 5) <= 2:
                                sig    = "SELL"
                                reason = (f"TA-BRAIN exit (rating {tv.get('rating',0)}/5): "
                                          f"{tv.get('reasoning','')[:100]}")
                                log(f"TA triggered exit: {reason[:80]}")
                        except Exception:
                            pass
                else:
                    sig, reason = "HOLD", "Auto-Manage OFF"


                if sig == "SELL":
                    sq = round(qty_held, 6)
                    if has_keys:
                        o = signed("/order", {"symbol":sym,"side":"SELL","type":"MARKET","quantity":fmt_qty(sq)}, "POST")
                        if isinstance(o, dict) and o.get("orderId"):
                            record_fill("SELL", fmt_qty(sq), price, o["orderId"], actor="bot", symbol=sym)
                            _record_exit(reason, price)
                            log(f"BOT SELL {sym} @ {price} ({reason})")
                    else:
                        # Paper trading fill
                        oid = f"paper-bot-{int(time.time()*1000)}"
                        record_fill("SELL", sq, price, oid, actor="bot", symbol=sym)
                        _record_exit(reason, price)
                        log(f"BOT PAPER SELL {sym} {sq} @ {price:.2f} ({reason})")
    except Exception as e:
        log(f"TICK ERR {e}")


def trader_loop():
    global _cycle_count
    log("trader loop started")
    while True:
        tick()
        _cycle_count += 1
        if _cycle_count % TUNE_CYCLE_EVERY == 0:
            try: self_tune()
            except Exception as e: log(f"TUNE ERROR {e}")
        time.sleep(LOOP_SECONDS)

SCANNER_RESULTS = []
def scanner_loop():
    global SCANNER_RESULTS
    log("scanner loop started")
    while True:
        try:
            # 1. Fetch top volume USDT pairs
            url = "https://api.binance.com/api/v3/ticker/24hr"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=10) as res:
                tickers = json.loads(res.read().decode())
            
            usdt_pairs = [t for t in tickers if t["symbol"].endswith("USDT") and float(t["quoteVolume"]) > 1000000]
            usdt_pairs.sort(key=lambda x: float(x["quoteVolume"]), reverse=True)
            top_pairs = usdt_pairs[:20] # scan top 20 for speed
            
            results = []
            for pair in top_pairs:
                sym = pair["symbol"]
                # get 15m klines
                kl = demo_get("/klines", {"symbol": sym, "interval": "15m", "limit": 100})
                if not isinstance(kl, list) or len(kl) < 20: continue
                
                closes = [float(k[4]) for k in kl]
                highs = [float(k[2]) for k in kl]
                lows = [float(k[3]) for k in kl]
                vols = [float(k[5]) for k in kl]
                
                r = rsi(closes)
                chg24 = float(pair["priceChangePercent"])
                vol_avg_val = vol_avg(vols, 20)
                vol_spike = vols[-1] / vol_avg_val if vol_avg_val > 0 else 1
                
                # Simple logic: classify as bullish, bearish, or neutral
                if r < 30: state = "Oversold Buy"
                elif r > 70: state = "Overbought Sell"
                elif chg24 > 5 and vol_spike > 1.5: state = "Momentum Breakout"
                else: state = "Neutral"
                
                results.append({
                    "symbol": sym,
                    "rsi": round(r, 1),
                    "priceChange": chg24,
                    "state": state,
                    "price": float(pair["lastPrice"])
                })
            
            # Sort: interesting ones first (oversold, overbought, breakout)
            results.sort(key=lambda x: (x["state"] == "Neutral", x["rsi"]))
            SCANNER_RESULTS = results
        except Exception as e:
            log(f"SCANNER ERROR {e}")
        time.sleep(300) # scan every 5 minutes

def _day_key(iso):
    return iso[:10]  # YYYY-MM-DD


def round_trips(fills):
    """Pair BUY->SELL fills into round-trips. Returns list of
    {entry_t, exit_t, entry_px, exit_px, qty, pnl, pnl_pct}."""
    trips = []
    open_buy = None
    for f in fills:
        if f["side"] == "BUY":
            open_buy = f
        elif f["side"] == "SELL" and open_buy is not None:
            qty = float(open_buy["qty"])
            ep, xp = float(open_buy["price"]), float(f["price"])
            pnl = (xp - ep) * qty
            trips.append({
                "entry_t": open_buy["t"], "exit_t": f["t"],
                "entry_px": ep, "exit_px": xp, "qty": qty,
                "pnl": round(pnl, 2), "pnl_pct": round((xp / ep - 1) * 100, 2),
            })
            open_buy = None
    return trips

def compute_analytics(fills):
    trips = round_trips(fills)
    if not trips:
        return {"round_trips": 0, "wins": 0, "losses": 0, "win_rate": 0.0,
                "profit_factor": 0.0, "avg_win": 0.0, "avg_loss": 0.0,
                "avg_hold_min": 0.0, "max_drawdown": 0.0, "expectancy": 0.0,
                "largest_win": 0.0, "largest_loss": 0.0,
                "per_strategy": {}}
    wins = [t for t in trips if t["pnl"] >= 0]
    losses = [t for t in trips if t["pnl"] < 0]
    gross_win = sum(t["pnl"] for t in wins)
    gross_loss = -sum(t["pnl"] for t in losses)
    wr = (len(wins) / len(trips)) * 100
    pf = round(gross_win / gross_loss, 2) if gross_loss > 0 else (round(gross_win, 2) if gross_win > 0 else 0.0)
    # equity curve from trips to derive drawdown
    eq = 0.0; peak = 0.0; mdd = 0.0
    for t in trips:
        eq += t["pnl"]
        peak = max(peak, eq)
        mdd = min(mdd, eq - peak)
    # average hold time (minutes)
    holds = []
    for t in trips:
        try:
            a = dt.datetime.fromisoformat(t["entry_t"].replace("Z", ""))
            b = dt.datetime.fromisoformat(t["exit_t"].replace("Z", ""))
            holds.append((b - a).total_seconds() / 60.0)
        except Exception:
            pass
    avg_hold = sum(holds) / len(holds) if holds else 0.0
    expectancy = (wr/100) * (gross_win/len(wins)) - ((100-wr)/100) * (gross_loss/len(losses)) if wins and losses else 0.0
    return {
        "round_trips": len(trips),
        "wins": len(wins), "losses": len(losses),
        "win_rate": round(wr, 1),
        "profit_factor": pf,
        "avg_win": round(gross_win/len(wins), 2) if wins else 0.0,
        "avg_loss": round(-gross_loss/len(losses), 2) if losses else 0.0,
        "avg_hold_min": round(avg_hold, 1),
        "max_drawdown": round(-mdd, 2),
        "expectancy": round(expectancy, 2),
        "largest_win": round(max(t["pnl"] for t in trips), 2),
        "largest_loss": round(min(t["pnl"] for t in trips), 2),
        "per_strategy": {},  # reserved; strategy tagging needs strategy in fill log
    }

# ---------------------------------------------------------------------------
# Self-improvement: evaluate BOTH strategy classes (reversion + breakout) over
# recent data with walk-forward (train 70% / test 30% out-of-sample), then switch
# the active strategy+params to the best out-of-sample performer. Avoids
# overfitting and lets the bot adapt to regime (choppy -> reversion, trending -> breakout).
# ---------------------------------------------------------------------------
TUNE_FILE = os.path.join(HERE, "tune_report.json")
TUNE_CYCLE_EVERY = 8          # run self_tune() every N ticks (~2h at 15m)
_cycle_count = 0

# candidate parameter sets per strategy the tuner explores
REV_CANDIDATES = [
    {"entry_ceil": 40, "exit_rsi": 55},
    {"entry_ceil": 45, "exit_rsi": 55},
    {"entry_ceil": 35, "exit_rsi": 50},
    {"entry_ceil": 50, "exit_rsi": 60},
    {"entry_ceil": 42, "exit_rsi": 52},
]
BRK_CANDIDATES = [
    {"lookback": 15, "vol_mult": 1.5},
    {"lookback": 20, "vol_mult": 1.5},
    {"lookback": 20, "vol_mult": 2.0},
    {"lookback": 25, "vol_mult": 1.3},
    {"lookback": 30, "vol_mult": 1.8},
]
STRATEGIES = {"reversion": REV_CANDIDATES, "breakout": BRK_CANDIDATES}

def backtest_closes(closes, strategy, params, vols=None):
    """Backtest a strategy+params over an explicit closes list (walk-forward)."""
    if vols is None:
        vols = [1.0] * len(closes)
    cash, pos, entry, trades = 1000.0, 0.0, 0.0, 0
    wins = losses = 0
    for i in range(14, len(closes)):
        sig, _ = gen_signal(closes, vols, i, (1 if pos > 0 else 0), entry, (0 if pos == 0 else trades), params, strategy)
        px = closes[i]
        if pos == 0 and sig == "BUY":
            entry = px; pos = cash/px; cash = 0.0; trades += 1
        elif pos > 0 and sig == "SELL":
            pnl = pos*px - pos*entry
            if pnl >= 0: wins += 1
            else: losses += 1
            cash = pos*px; pos = 0.0
    if pos > 0: cash = pos*closes[-1]
    ret = (cash-1000.0)/1000.0
    wr = (wins/(wins+losses))*100 if (wins+losses) else 0.0
    return {"ret": round(ret*100,2), "win_rate": round(wr,1), "trades": trades,
            "wins": wins, "losses": losses, "max_dd": 0.0}

def self_tune():
    """Walk-forward: for EACH strategy, pick best params on the training 70%,
    score out-of-sample on the test 30%. Switch active strategy to the best OOS."""
    global STRATEGY, STRATEGY_PARAMS
    kl = demo_get("/klines", {"symbol":SYMBOL,"interval":KL_INTERVAL,"limit":500})
    if not isinstance(kl, list) or len(kl) < 150:
        log("SELF-TUNE skipped: not enough klines"); return None
    closes = [float(k[4]) for k in kl]
    vols = [float(k[5]) for k in kl]
    cut = int(len(closes)*0.7)
    train_c, test_c = closes[:cut], closes[cut:]
    train_v, test_v = vols[:cut], vols[cut:]
    results = []
    for strat, cands in STRATEGIES.items():
        best_params = None; best_train = None
        for p in cands:
            m = backtest_closes(train_c, strat, p, train_v)
            if best_train is None or m["ret"] > best_train["ret"]:
                best_train = m; best_params = p
        test_m = backtest_closes(test_c, strat, best_params, test_v)
        results.append({"strategy": strat, "params": best_params,
                        "train_ret": best_train["ret"], "test_ret": test_m["ret"],
                        "trades": test_m["trades"], "win_rate": test_m["win_rate"]})
    results.sort(key=lambda x: x["test_ret"], reverse=True)
    best = results[0]
    cur_m = backtest_closes(test_c, STRATEGY, STRATEGY_PARAMS, test_v)
    cur_test = cur_m["ret"] if cur_m else 0.0
    applied = False
    if best["test_ret"] > cur_test + 1.0:
        STRATEGY, STRATEGY_PARAMS = best["strategy"], best["params"]; applied = True
    report = {
        "ts": dt.datetime.now().isoformat(),
        "method": "walk-forward 70/30 (per strategy, OOS)",
        "current": {"strategy": STRATEGY, "params": STRATEGY_PARAMS, "test_ret": cur_test},
        "best": best,
        "applied": applied,
        "candidates": results,
    }
    try:
        with open(TUNE_FILE, "w") as f:
            json.dump(report, f, indent=2)
    except Exception:
        pass
    log(f"SELF-TUNE best={best['strategy']} test_ret={best['test_ret']}% applied={applied}")
    return report

def _state_atr():
    """Current ATR for the dashboard (small klines call; cached cheaply by callers)."""
    try:
        kl = demo_get("/klines", {"symbol": SYMBOL, "interval": KL_INTERVAL, "limit": 60})
        if isinstance(kl, list) and len(kl) >= 16:
            h = [float(k[2]) for k in kl]; l = [float(k[3]) for k in kl]; c = [float(k[4]) for k in kl]
            return round(atr(h, l, c, 14), 2)
    except Exception:
        pass
    return 0.0


def _state_regime():
    """Current market regime (label, score) for the dashboard."""
    try:
        kl = demo_get("/klines", {"symbol": SYMBOL, "interval": KL_INTERVAL, "limit": 120})
        if isinstance(kl, list) and len(kl) >= 40:
            c = [float(k[4]) for k in kl]; h = [float(k[2]) for k in kl]; l = [float(k[3]) for k in kl]
            return regime(c, h, l)
    except Exception:
        pass
    return ("ranging", 0.0)



def get_all_prices():
    try:
        url = "https://api.binance.com/api/v3/ticker/price"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=10) as res:
            data = json.loads(res.read().decode())
            return {item["symbol"]: float(item["price"]) for item in data}
    except Exception: return {}

def pnl_by_actor(fills, prices=None):
    if prices is None: prices = get_all_prices()
    res = {"bot": {"realized":0.0, "open_value":0.0, "net":0.0, "btc_open":0.0},
           "user": {"realized":0.0, "open_value":0.0, "net":0.0, "btc_open":0.0}}
    for act in ["bot", "user"]:
        f_act = [f for f in fills if f.get("actor", "bot") == act]
        cash = 0.0
        bal = {}
        for f in f_act:
            sym = f.get("symbol", SYMBOL)
            q = float(f["qty"]); p = float(f["price"])
            if f["side"] == "BUY":
                cash -= q * p
                bal[sym] = bal.get(sym, 0.0) + q
            else:
                cash += q * p
                bal[sym] = bal.get(sym, 0.0) - q
        
        open_val = 0.0
        btc_open = 0.0
        for sym, qty in bal.items():
            if qty > DUST:
                p = prices.get(sym, 0.0)
                open_val += qty * p
                if sym == SYMBOL: btc_open += qty
        
        res[act]["realized"] = cash
        res[act]["open_value"] = open_val
        res[act]["net"] = cash + open_val
        res[act]["btc_open"] = btc_open
    return res

def portfolio_analytics(fills):
    day_pnl = {}
    day_gain = {}
    day_loss = {}
    for f in fills:
        d = _day_key(f["t"])
        p = float(f["price"]) * float(f["qty"])
        if f["side"] == "BUY":
            day_pnl[d] = day_pnl.get(d, 0.0) - p
        else:
            day_pnl[d] = day_pnl.get(d, 0.0) + p
    for d, v in day_pnl.items():
        if v >= 0: day_gain[d] = day_gain.get(d, 0.0) + v
        else:      day_loss[d] = day_loss.get(d, 0.0) + abs(v)

    today = dt.datetime.now().strftime("%Y-%m-%d")
    yesterday = (dt.datetime.now() - dt.timedelta(days=1)).strftime("%Y-%m-%d")
    week_ago = (dt.datetime.now() - dt.timedelta(days=7)).strftime("%Y-%m-%d")

    def sum_range(start, end):
        g = sum(v for d, v in day_gain.items() if start <= d <= end)
        l = sum(v for d, v in day_loss.items() if start <= d <= end)
        return g, l, g - l

    wk_gain, wk_loss, wk_net = sum_range(week_ago, today)
    return {
        "realized_total": sum(day_pnl.values()),
        "today_gain": day_gain.get(today, 0.0),
        "today_loss": day_loss.get(today, 0.0),
        "today_net": day_pnl.get(today, 0.0),
        "yesterday_gain": day_gain.get(yesterday, 0.0),
        "yesterday_loss": day_loss.get(yesterday, 0.0),
        "yesterday_net": day_pnl.get(yesterday, 0.0),
        "week_gain": wk_gain, "week_loss": wk_loss, "week_net": wk_net
    }

def make_state():
    fills = load_fills()
    prices = get_all_prices()
    current_price = prices.get(SYMBOL) or demo_price()
    
    cash = float(MAX_CAPITAL)
    balances = {}
    equity = []
    
    for f in fills:
        sym = f.get("symbol", SYMBOL)
        qty = float(f["qty"])
        price = float(f["price"])
        if f["side"] == "BUY":
            cash -= qty * price
            balances[sym] = balances.get(sym, 0.0) + qty
        else:
            cash += qty * price
            balances[sym] = balances.get(sym, 0.0) - qty
        
        # Approximate equity at fill
        eq_at_fill = cash + sum(balances.get(s, 0.0) * price for s in balances if balances[s] > DUST)
        equity.append({"t": f["t"], "equity": round(eq_at_fill, 2)})

    open_symbols = [sym for sym, qty in balances.items() if qty > DUST]
    
    positions_data = []
    total_unrealized = 0.0
    for sym in open_symbols:
        qty = balances[sym]
        p = prices.get(sym, 0.0)
        if p == 0: continue
        entry = p
        for f in reversed(fills):
            if f.get("symbol", SYMBOL) == sym and f["side"] == "BUY":
                entry = float(f["price"])
                break
        unrealized = (p - entry) * qty
        total_unrealized += unrealized
        positions_data.append({
            "symbol": sym, "side": "LONG", "qty": round(qty, 6), "entry": entry,
            "mark_price": p, "unrealized_pnl": round(unrealized, 2),
            "unrealized_pct": round((p / entry - 1) * 100, 2) if entry > 0 else 0
        })
        
    total_funds = cash + sum(balances[s] * prices.get(s, 0.0) for s in open_symbols)
    realized = cash - float(MAX_CAPITAL)
    
    equity.append({"t": dt.datetime.now().isoformat(), "equity": round(total_funds, 2)})
    
    return {
        "symbol": SYMBOL,
        "price": current_price,
        "usdt": round(cash, 2),
        "total_funds": round(total_funds, 2),
        "realized": round(realized, 2),
        "net_pnl": round(total_funds - float(MAX_CAPITAL), 2),
        "fills": len(fills),
        "round_trips": len([f for f in fills if f["side"]=="SELL"]),
        "equity_curve": equity,
        "portfolio": portfolio_analytics(fills),
        "positions": positions_data,
        "strategy": STRATEGY,
        "strategy_params": STRATEGY_PARAMS,
        "strategies": {k: {"name": v["name"], "desc": v["desc"], "params": v["params"]} for k, v in STRATEGY_LIB.items()},
        "creds_loaded": bool(creds().get("apiKey")),
        "max_capital": MAX_CAPITAL,
        "regime": _state_regime()[0],
        "regime_score": _state_regime()[1],
        "atr": _state_atr(),
        "trailing_stop": _trail_stop,
        "updated": dt.datetime.now().isoformat(),
        "pnl_by_actor": pnl_by_actor(fills, prices),
        "manual_state": MANUAL_STATE.get(SYMBOL, {}),
        "ai": get_last_ai(),
    }


def current_signal():
    """Compute the LIVE signal the bot is looking at right now, with reason +
    supporting context, so the dashboard can show 'current trade signal'."""
    try:
        price = demo_price()
        if price == 0:
            return {"signal": "HOLD", "reason": "price unavailable", "rsi": None,
                    "regime": None, "strategy": STRATEGY}
        kl = demo_get("/klines", {"symbol": SYMBOL, "interval": KL_INTERVAL, "limit": 300})
        if not isinstance(kl, list) or len(kl) < 30:
            return {"signal": "HOLD", "reason": "klines loading", "rsi": None,
                    "regime": None, "strategy": STRATEGY}
        closes = [float(k[4]) for k in kl]
        vols = [float(k[5]) for k in kl]
        highs = [float(k[2]) for k in kl]
        lows = [float(k[3]) for k in kl]
        sr = sr_zones(highs, lows, closes, vols)
        i = len(closes) - 1
        r = rsi(closes)
        reg_label, reg_score = regime(closes, highs, lows)
        _fills = load_fills()
        btc = 0.0
        for f in _fills:
            btc += float(f["qty"]) if f["side"] == "BUY" else -float(f["qty"])
        pos = 1 if btc > DUST else 0
        fb = last_buy(_fills)
        entry = float(fb["price"]) if fb else price
        held = int((dt.datetime.now() - dt.datetime.fromisoformat(fb["t"])).total_seconds()/60/_interval_minutes()) if fb else 0
        cur_atr = atr(highs, lows, closes, 14)
        sig, reason = gen_signal(closes, vols, i, pos, entry, held, STRATEGY_PARAMS,
                                STRATEGY, sr, atr_val=cur_atr, regime_label=reg_label)
        return {
            "signal": sig,
            "reason": reason,
            "rsi": round(r, 1),
            "regime": reg_label,
            "regime_score": round(reg_score, 2),
            "strategy": STRATEGY,
            "strategy_name": STRATEGY_LIB[STRATEGY]["name"],
            "price": round(price, 2),
            "position": "LONG" if pos else "FLAT",
            "ai": (lambda: (_safe_ai(sig, {"symbol": SYMBOL, "position": "LONG" if pos else "FLAT",
                        "rsi": round(r, 1), "regime": reg_label, "price": round(price, 2),
                        "support": sr[1] if sr else None, "resistance": sr[0] if sr else None,
                        "strategy": STRATEGY})))(),
        }
    except Exception as e:
        return {"signal": "HOLD", "reason": f"error: {e}", "rsi": None,
                "regime": None, "strategy": STRATEGY}

def current_risk():
    """Explain WHY the bot isn't trading right now and the risk of placing a
    trade at the current price (SL/TP/ATR-based)."""
    try:
        price = demo_price()
        if price == 0:
            return {"trading_blocked": True, "reason": "price feed unavailable"}
        kl = demo_get("/klines", {"symbol": SYMBOL, "interval": KL_INTERVAL, "limit": 300})
        if not isinstance(kl, list) or len(kl) < 30:
            return {"trading_blocked": True, "reason": "market data loading"}
        closes = [float(k[4]) for k in kl]
        highs = [float(k[2]) for k in kl]
        lows = [float(k[3]) for k in kl]
        vols = [float(k[5]) for k in kl]
        sr = sr_zones(highs, lows, closes, vols)
        r = rsi(closes)
        reg_label, reg_score = regime(closes, highs, lows)
        cur_atr = atr(highs, lows, closes, 14)
        _fills = load_fills()
        btc = 0.0; usdt = float(MAX_CAPITAL)
        for f in _fills:
            if f["side"] == "BUY":
                btc += float(f["qty"]); usdt -= float(f["qty"]) * float(f["price"])
            else:
                btc -= float(f["qty"]); usdt += float(f["qty"]) * float(f["price"])
        flat = btc <= DUST
        blocks = []
        if flat:
            sig, reason = gen_signal(closes, vols, len(closes)-1, 0, 0.0, 0, STRATEGY_PARAMS,
                                     STRATEGY, sr, atr_val=cur_atr, regime_label=reg_label)
            if sig != "BUY":
                blocks.append(f"Signal is {sig} ({reason}) — no long entry trigger yet.")
            if reg_label == "trending" and STRATEGY in ("reversion", "sr_bounce"):
                blocks.append("Mean-reversion paused: market is trending.")
            if reg_label == "choppy" and STRATEGY in ("breakout", "ema_trend"):
                blocks.append("Trend strategy paused: market is choppy/ranging.")
            if usdt < SIZE_MIN:
                blocks.append(f"USDT {usdt:.2f} below Binance min notional {SIZE_MIN:.2f}.")
        else:
            blocks.append("Already holding a position — bot only adds on BUY when FLAT.")
        tp, sl = None, None
        try:
            res = min((z["level"] for z in sr if z["type"] == "R" and z["level"] > price), default=None)
            sup = max((z["level"] for z in sr if z["type"] == "S" and z["level"] < price), default=None)
            if res: tp = min(res, price * (1 + TP_CAP))
            if sup: sl = max(sup, price * (1 - SL_CAP))
        except Exception:
            pass
        if tp is None: tp = round(price * (1 + TP_PCT), 2)
        else: tp = round(tp, 2)
        if sl is None: sl = round(price * (1 - SL_PCT), 2)
        else: sl = round(sl, 2)
        risk_pct = round((price - sl) / price * 100, 2)
        reward_pct = round((tp - price) / price * 100, 2)
        return {
            "trading_blocked": bool(blocks),
            "block_reasons": blocks,
            "signal": gen_signal(closes, vols, len(closes)-1, 0 if flat else 1,
                                 (last_buy(_fills) or {}).get("price", price), 0,
                                 STRATEGY_PARAMS, STRATEGY, sr,
                                 atr_val=cur_atr, regime_label=reg_label)[0],
            "regime": reg_label,
            "regime_score": round(reg_score, 2),
            "rsi": round(r, 1),
            "atr": round(cur_atr, 2) if cur_atr else None,
            "entry_risk": {
                "sl_price": sl,
                "tp_price": tp,
                "risk_pct": risk_pct,
                "reward_pct": reward_pct,
                "rr": round((tp - price) / (price - sl), 2) if (price - sl) else 0.0,
            },
            "available_usdt": round(usdt, 2),
            "flat": flat,
        }
    except Exception as e:
        return {"trading_blocked": True, "reason": f"error: {e}"}

def strategy_detail():
    """Human-readable explanation of the ACTIVE strategy for the dashboard's
    'Strategy' tab."""
    key = STRATEGY
    lib = STRATEGY_LIB[key]
    try:
        kl = demo_get("/klines", {"symbol": SYMBOL, "interval": KL_INTERVAL, "limit": 300})
        closes = [float(k[4]) for k in kl] if isinstance(kl, list) else []
        r = rsi(closes) if closes else None
        reg_label, reg_score = regime(closes, [float(k[2]) for k in kl], [float(k[3]) for k in kl]) if closes else ("ranging", 0.0)
    except Exception:
        r, reg_label, reg_score = None, "ranging", 0.0
    explainers = {
        "reversion": "Waits for RSI to fall into the oversold zone and turn UP (momentum flip), then buys, betting price snaps back to the mean. Exits when RSI recovers or hits a structure target. Best in ranging/sideways markets.",
        "breakout": "Buys only when price closes ABOVE its N-bar high WITH above-average volume and a positive MACD histogram — i.e. a confirmed breakout. Exits on a breakdown below the N-bar low. Best in trending markets.",
        "ema_trend": "Buys on an EMA 'golden cross' (fast EMA crossing above slow EMA) while price is above the slow EMA. Exits on a 'death cross' or a close below the slow EMA. Trend-following.",
        "sr_bounce": "Buys when price pulls back to a detected SUPPORT zone with RSI turning up, targeting the nearest RESISTANCE. Structure-based mean reversion.",
    }
    return {
        "key": key,
        "name": lib["name"],
        "description": lib["desc"],
        "how_it_works": explainers.get(key, lib["desc"]),
        "params": lib["params"],
        "current_rsi": round(r, 1) if r is not None else None,
        "regime": reg_label,
        "regime_score": round(reg_score, 2),
        "tuned": load_tune(),
        "all_strategies": {k: {"name": v["name"], "desc": v["desc"], "params": v["params"]}
                           for k, v in STRATEGY_LIB.items()},
    }

class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        data = body.encode() if isinstance(body,str) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type",ctype)
        self.send_header("Content-Length",str(len(data)))
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Methods","GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers","Content-Type")
        self.end_headers(); self.wfile.write(data)
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Methods","GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers","Content-Type")
        self.end_headers()
    def do_POST(self):
        global MANUAL_STATE

        # /api/strategy  -> switch active strategy
        # /api/settings  -> update user-controlled settings (e.g. max_capital)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length else b"{}"
            body = json.loads(raw.decode()) if raw else {}
        except Exception:
            body = {}
        if self.path in ("/api/strategy",):
            key = body.get("strategy")
            ok = set_strategy(key) if key else False
            if ok:
                self._send(200, {"ok": True, "strategy": key})
            else:
                self._send(400, {"ok": False, "error": f"unknown strategy '{key}'"})
        elif self.path in ("/api/settings",):
            global MAX_CAPITAL
            try:
                cap = float(body.get("max_capital", MAX_CAPITAL))
            except (TypeError, ValueError):
                cap = MAX_CAPITAL
            if cap <= 0:
                self._send(400, {"ok": False, "error": "max_capital must be > 0"})
                return
            MAX_CAPITAL = cap
            try:
                cur = {}
                if os.path.exists(SETTINGS_FILE):
                    cur = json.load(open(SETTINGS_FILE))
                cur["max_capital"] = cap
                json.dump(cur, open(SETTINGS_FILE, "w"))
            except Exception as e:
                self._send(500, {"ok": False, "error": str(e)})
                return
            self._send(200, {"ok": True, "max_capital": MAX_CAPITAL})
        elif self.path in ("/api/symbol",):
            global SYMBOL, _trail_stop
            sym = str(body.get("symbol", SYMBOL)).upper()
            if not sym:
                self._send(400, {"ok": False, "error": "symbol required"})
                return
            SYMBOL = sym
            _trail_stop = None # reset trailing stop state
            try:
                cur = {}
                if os.path.exists(SETTINGS_FILE):
                    cur = json.load(open(SETTINGS_FILE))
                cur["symbol"] = SYMBOL
                json.dump(cur, open(SETTINGS_FILE, "w"))
            except Exception as e:
                self._send(500, {"ok": False, "error": str(e)})
                return
            self._send(200, {"ok": True, "symbol": SYMBOL})
        elif self.path in ("/api/manual-order",):
            side = str(body.get("side", "")).upper()
            if side not in ("BUY", "SELL"):
                self._send(400, {"ok": False, "error": "side must be BUY or SELL"})
                return
            sym = body.get("symbol", SYMBOL)
            price = get_all_prices().get(sym) or demo_price()
            if price <= 0:
                self._send(500, {"ok": False, "error": "price feed unavailable"})
                return
            
            _fills = load_fills()
            sym = body.get("symbol", SYMBOL)
            btc = 0.0; usdt = float(MAX_CAPITAL)
            for f in _fills:
                s = f.get("symbol", SYMBOL)
                q = float(f["qty"])
                p = float(f["price"])
                if f["side"] == "BUY":
                    if s == sym: btc += q
                    usdt -= q * p
                else:
                    if s == sym: btc -= q
                    usdt += q * p
            btc = max(btc, 0.0); usdt = max(usdt, 0.0)
            oid = None
            if side == "BUY":
                notional = min(float(body.get("notional", usdt * 0.95)), usdt * 0.95, MAX_CAPITAL)
                if notional < SIZE_MIN:
                    self._send(400, {"ok": False, "error": f"notional {notional:.2f} below min {SIZE_MIN:.2f}"})
                    return
                qty = round(notional / price, 6)
                if qty <= 0:
                    self._send(400, {"ok": False, "error": "computed qty <= 0"})
                    return
                oid = record_manual("BUY", qty, price, symbol=sym)
                msg = f"MANUAL BUY {qty} @ {price:.2f} (you)"
                
                # Save manual state for this new position
                if sym not in MANUAL_STATE or not isinstance(MANUAL_STATE[sym], dict): MANUAL_STATE[sym] = {}
                MANUAL_STATE[sym]["auto_manage"] = bool(body.get("auto_manage", True))
                MANUAL_STATE[sym]["sl"] = body.get("sl")
                MANUAL_STATE[sym]["tp"] = body.get("tp")
                try:
                    cur = {}
                    if os.path.exists(SETTINGS_FILE): cur = json.load(open(SETTINGS_FILE))
                    cur["manual"] = MANUAL_STATE
                    json.dump(cur, open(SETTINGS_FILE, "w"))
                except Exception: pass
            else:  # SELL
                qty = float(body.get("qty", btc))
                qty = min(qty, btc)
                if qty <= DUST:
                    self._send(400, {"ok": False, "error": "no BTC position to sell"})
                    return
                qty = round(qty, 6)
                oid = record_manual("SELL", qty, price, symbol=sym)
                msg = f"MANUAL SELL {qty} @ {price:.2f} (you)"
            log(msg)
            self._send(200, {"ok": True, "order": oid, "side": side,
                             "qty": qty if side == "SELL" else round(notional / price, 6),
                             "price": round(price, 2), "actor": "user"})
        elif self.path in ("/api/manual-update",):
            sym = body.get("symbol", SYMBOL)
            if sym not in MANUAL_STATE or not isinstance(MANUAL_STATE[sym], dict): MANUAL_STATE[sym] = {}
            MANUAL_STATE[sym]["auto_manage"] = bool(body.get("auto_manage", True))
            MANUAL_STATE[sym]["sl"] = body.get("sl")
            MANUAL_STATE[sym]["tp"] = body.get("tp")
            try:
                cur = {}
                if os.path.exists(SETTINGS_FILE): cur = json.load(open(SETTINGS_FILE))
                cur["manual"] = MANUAL_STATE
                json.dump(cur, open(SETTINGS_FILE, "w"))
            except Exception: pass
            self._send(200, {"ok": True})
        elif self.path in ("/api/exit",):
            # Liquidate current position instantly
            _fills = load_fills()
            sym = body.get("symbol", SYMBOL) if body else SYMBOL
            btc = 0.0
            for f in _fills:
                if f.get("symbol", SYMBOL) == sym:
                    if f["side"] == "BUY": btc += float(f["qty"])
                    else: btc -= float(f["qty"])
            if btc <= DUST:
                self._send(400, {"ok": False, "error": f"No open {sym} position to exit."})
                return
            price = get_all_prices().get(sym) or demo_price()
            qty = round(btc, 6)
            oid = record_manual("SELL", qty, price, symbol=sym)
            log(f"MANUAL EXIT {qty} @ {price:.2f} (you)")
            self._send(200, {"ok": True, "order": oid, "qty": qty, "price": price})
        elif self.path in ("/api/ta-run",):
            try:
                from ta_engine import is_analyzing, trigger_ta_analysis_async
                if is_analyzing():
                    self._send(200, {"ok": True, "started": False, "message": "Multi-agent analysis is already running."})
                else:
                    started = trigger_ta_analysis_async()
                    self._send(200, {"ok": True, "started": started, "message": "Multi-agent analysis started."})
            except Exception as e:
                self._send(500, {"ok": False, "error": str(e)})
        else:
            self._send(404, {"ok": False, "error": "not found"})
    def do_GET(self):
        if self.path in ("/api/state",):
            self._send(200, make_state())
        elif self.path in ("/api/price",):
            # lightweight, fast: price + position only (no signed /account call),
            # so the frontend's 2s poll stays near-real-time.
            try:
                price = live_price()
                self._send(200, {"price": price, "updated": dt.datetime.now().isoformat()})
            except Exception as e:
                self._send(500, {"error": str(e)})
        elif self.path in ("/api/stream",):
            # Server-Sent Events: push live price to the browser ~3x/sec via the
            # same tunnel the dashboard already uses, so it works even if the
            # browser cannot reach Binance's WebSocket directly.
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()
            try:
                last = 0.0
                beats = 0
                while True:
                    try:
                        p = live_price()
                    except Exception:
                        p = 0.0
                    now = time.time()
                    if p > 0 and (now - last >= 0.3):
                        payload = json.dumps({"price": p, "t": int(now * 1000)}).encode()
                        try:
                            self.wfile.write(b"data: " + payload + b"\n\n")
                            self.wfile.flush()
                        except Exception:
                            break  # client disconnected
                        last = now
                        beats = 0
                    else:
                        beats += 1
                        if beats >= 6:  # heartbeat every ~2s of no data
                            try:
                                self.wfile.write(b": ping\n\n")
                                self.wfile.flush()
                            except Exception:
                                break
                            beats = 0
                    time.sleep(0.1)
            except Exception:
                pass
            return
        elif self.path in ("/api/fills",):
            self._send(200, list(reversed(load_fills()[-50:])))
        elif self.path in ("/api/tune",):
            try:
                rep = self_tune()
            except Exception as e:
                rep = {"error": str(e)}
            self._send(200, rep or load_tune() or {"status": "no data"})
        elif self.path.startswith("/api/klines"):
            try:
                # allow ?interval=1h / ?limit=300 overrides (validated)
                q = self.path.split("?", 1)[1] if "?" in self.path else ""
                params = dict(p.split("=", 1) for p in q.split("&") if "=" in p)
                interval = params.get("interval", KL_INTERVAL)
                try:
                    limit = int(params.get("limit", "300"))
                except ValueError:
                    limit = 300
                limit = max(50, min(1000, limit))
                if interval not in ("1m","3m","5m","15m","30m","1h","2h","4h","6h","12h","1d","3d","1w"):
                    interval = KL_INTERVAL
                kl = demo_get("/klines", {"symbol": SYMBOL, "interval": interval, "limit": limit})
                if not isinstance(kl, list):
                    self._send(502, {"error": "klines unavailable"})
                else:
                    candles = [{"t": k[0], "o": float(k[1]), "h": float(k[2]),
                                "l": float(k[3]), "c": float(k[4]), "v": float(k[5])} for k in kl]
                    self._send(200, {"symbol": SYMBOL, "interval": interval, "price": demo_price(), "candles": candles})
            except Exception as e:
                self._send(500, {"error": str(e)})

        elif self.path.startswith("/api/indicators"):
            try:
                q = self.path.split("?", 1)[1] if "?" in self.path else ""
                params = dict(p.split("=", 1) for p in q.split("&") if "=" in p)
                interval = params.get("interval", KL_INTERVAL)
                if interval not in ("1m","3m","5m","15m","30m","1h","2h","4h","6h","12h","1d","3d","1w"):
                    interval = KL_INTERVAL
                self._send(200, compute_indicators_cached(interval))
            except Exception as e:
                self._send(500, {"error": str(e)})

        elif self.path in ("/api/strategies",):
            self._send(200, {"current": get_strategy_key(),
                             "strategies": {k: {"name": v["name"], "desc": v["desc"], "params": v["params"]}
                                            for k, v in STRATEGY_LIB.items()}})

        elif self.path in ("/api/settings",):
            self._send(200, {"max_capital": MAX_CAPITAL,
                             "size_min": SIZE_MIN,
                             "max_notional": MAX_NOTIONAL})

        elif self.path in ("/api/analytics",):
            try:
                a = compute_analytics(load_fills())
                self._send(200, a)
            except Exception as e:
                self._send(500, {"error": str(e)})

        elif self.path in ("/api/scanner",):
            self._send(200, {"results": SCANNER_RESULTS})

        elif self.path in ("/api/ta-verdict",):
            try:
                from ta_engine import get_ta_verdict, OPENROUTER_API_KEY, ROUTER_BASE_URL, ROUTER_DEEP_MODEL, ROUTER_FAST_MODEL, TA_INTERVAL_HOURS
                verdict = get_ta_verdict()
                if verdict:
                    self._send(200, verdict)
                else:
                    self._send(200, {
                        "signal": "HOLD", "rating": 0,
                        "reasoning": "No analysis yet — first cycle starts automatically." if OPENROUTER_API_KEY else
                                     "TradingAgents disabled. Set OPENROUTER_API_KEY in backend/.env",
                        "analyst_summaries": {},
                        "ts": None, "ticker": SYMBOL,
                        "enabled": bool(OPENROUTER_API_KEY),
                        "provider": "openrouter",
                        "deep_model": ROUTER_DEEP_MODEL,
                        "fast_model": ROUTER_FAST_MODEL,
                        "router_url": ROUTER_BASE_URL,
                        "interval_hours": TA_INTERVAL_HOURS,
                    })
            except Exception as e:
                self._send(200, {"signal": "HOLD", "rating": 0,
                                 "reasoning": f"TA engine error: {e}", "ts": None,
                                 "enabled": False})

        elif self.path in ("/api/signal",):
            self._send(200, current_signal())

        elif self.path in ("/api/risk",):
            self._send(200, current_risk())

        elif self.path in ("/api/strategy-detail",):
            self._send(200, strategy_detail())

        elif self.path in ("/api/multi-agents",):
            try:
                from multi_agent_executor import get_agent_registry
                self._send(200, get_agent_registry())
            except Exception as e:
                self._send(500, {"error": str(e)})

        elif self.path.startswith("/api/quantharness/backtest"):
            try:
                from quantharness_engine import run_quantharness_backtest
                kl = demo_get("/klines", {"symbol": SYMBOL, "interval": KL_INTERVAL, "limit": 500})
                if not isinstance(kl, list) or len(kl) < 40:
                    self._send(400, {"error": "Insufficient candle history"})
                else:
                    candles = [{"close": float(k[4]), "high": float(k[2]), "low": float(k[3]), "volume": float(k[5]), "time": k[0]} for k in kl]
                    bt_res = run_quantharness_backtest(candles)
                    self._send(200, bt_res)
            except Exception as e:
                self._send(500, {"error": str(e)})

        elif self.path.startswith("/api/quantharness/patterns"):
            try:
                from quantharness_engine import detect_chart_patterns
                kl = demo_get("/klines", {"symbol": SYMBOL, "interval": KL_INTERVAL, "limit": 40})
                candles = [{"close": float(k[4]), "high": float(k[2]), "low": float(k[3]), "volume": float(k[5])} for k in kl]
                self._send(200, detect_chart_patterns(candles))
            except Exception as e:
                self._send(500, {"error": str(e)})

        elif self.path.startswith("/api/backtest"):
            try:
                import urllib.parse as _up
                q = _up.urlparse(self.path).query
                days = int(_up.parse_qs(q).get("days", ["30"])[0])
                days = max(3, min(180, days))
                kl = demo_get("/klines", {"symbol": SYMBOL, "interval": KL_INTERVAL, "limit": min(1000, days * 96)})
                if not isinstance(kl, list) or len(kl) < 60:
                    self._send(400, {"error": "not enough klines"})
                else:
                    closes = [float(k[4]) for k in kl]
                    vols = [float(k[5]) for k in kl]
                    out = []
                    for strat, params in STRATEGIES.items():
                        p = params[0]
                        m = backtest_closes(closes, strat, p, vols)
                        out.append({"strategy": strat, "params": p})
                        out[-1].update(m)
                    out.sort(key=lambda x: x["ret"], reverse=True)
                    self._send(200, {"days": days, "interval": KL_INTERVAL,
                                     "symbol": SYMBOL, "results": out})
            except Exception as e:
                self._send(500, {"error": str(e)})

        elif self.path in ("/", "/index.html"):
            fpath = os.path.join(HERE, "static", "index.html")
            if os.path.exists(fpath):
                self._send(200, open(fpath).read(), "text/html")
            else:
                self._send(200, "<h1>Paper Trader API</h1><p>/api/state /api/fills</p>", "text/html")
        else:
            self._send(404, {"error":"not found"})

    def log_message(self, *a): pass

class DualStackServer(HTTPServer):
    """Bind on both IPv4 and IPv6 so cloudflared can reach us whether it
    resolves localhost -> 127.0.0.1 (IPv4) or ::1 (IPv6). The default
    HTTPServer('0.0.0.0', PORT) only listens on IPv4, so on machines where
    'localhost' resolves to ::1 the tunnel gets 'connection refused' and the
    dashboard shows offline even though the bot is running."""
    address_family = socket.AF_INET6
    allow_reuse_address = True   # SO_REUSEADDR — lets the socket rebind immediately after crash

    def server_bind(self):
        # Enable dual-stack (IPv4-mapped IPv6) so the same socket handles
        # both 127.0.0.1 (cloudflared) and ::1 connections.
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except Exception:
            pass
        # SO_REUSEADDR — already set via allow_reuse_address, belt-and-suspenders
        try:
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        except Exception:
            pass
        super().server_bind()


if __name__ == "__main__":
    # Guard: refuse to start if :PORT is already taken (e.g. a second
    # start.py / orphaned app.py). A silent double-bind caused
    # ConnectionAbortedError flakiness before.
    import socket as _sock
    _s = _sock.socket(_sock.AF_INET6, _sock.SOCK_STREAM)
    try:
        _s.setsockopt(_sock.IPPROTO_IPV6, _sock.IPV6_V6ONLY, 0)
        _s.setsockopt(_sock.SOL_SOCKET, _sock.SO_REUSEADDR, 1)
    except Exception:
        pass
    try:
        _s.bind(("::", PORT))
    except OSError as e:
        log(f"FATAL: port {PORT} already in use ({e}). Another bot is running — exit.")
        sys.exit(1)
    finally:
        _s.close()

    threading.Thread(target=trader_loop, daemon=True).start()
    threading.Thread(target=scanner_loop, daemon=True).start()
    try:
        from multi_agent_executor import start_multi_agent_executor
        start_multi_agent_executor()
        log("Multi-Agent High-Frequency Execution Grid started (5 agents hunting 20 pairs)")
    except Exception as _mag_err:
        log(f"Multi-Agent Executor error: {_mag_err}")
    # Start TradingAgents LLM brain loop (requires OPENROUTER_API_KEY in .env)
    try:
        from ta_engine import start_ta_loop
        start_ta_loop()
    except Exception as _ta_err:
        log(f"TA engine not started: {_ta_err}")
    log(f"API on :{PORT} (dual-stack IPv4+IPv6)")
    # Wrap serve_forever in a retry loop — if a transient socket error kills
    # the serve loop (e.g. ConnectionAbortedError on Windows), restart the
    # server in-place rather than dying and leaving the tunnel pointing at a
    # dead port.
    while True:
        try:
            DualStackServer(("::", PORT), H).serve_forever()
        except Exception as _srv_err:
            log(f"WARN: server loop died ({_srv_err}), restarting in 2s ...")
            time.sleep(2)
