#!/usr/bin/env python3
"""Paper Trader API - serves dashboard data + runs the demo paper-trader.
Stdlib only (no pip) so it deploys on Render's free tier without dependency issues.
Endpoints:
  GET /api/state   - live demo balance + bot P&L + equity curve + portfolio analytics
  GET /api/fills   - trade history (newest first)
  GET /           - optional: serve built frontend if present
Also launches the trading loop in a background thread (RSI 15m mean-reversion, demo only).
"""
import os, json, time, hmac, hashlib, datetime as dt, threading, urllib.request, urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
KEYFILE = os.path.join(HERE, "testnet_keys.json")
FILL_LOG = os.path.join(HERE, "fills.jsonl")
BASE = "https://demo-api.binance.com/api"
SYMBOL = os.getenv("SYMBOL", "BTCUSDT")
KL_INTERVAL = os.getenv("KL_INTERVAL", "15m")
LOOP_SECONDS = int(os.getenv("LOOP_SECONDS", "900"))
MAX_NOTIONAL = float(os.getenv("MAX_NOTIONAL", "25"))
RSI_LOW, RSI_HIGH = 45, 55   # RSI_LOW = entry RSI ceiling; RSI_HIGH = neutral exit RSI (mean-reversion target)
# Risk / execution controls (all env-overridable, safe defaults)
SL_PCT = float(os.getenv("SL_PCT", "0.03"))      # 3% hard stop-loss
TP_PCT = float(os.getenv("TP_PCT", "0.05"))       # 5% take-profit
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

def _open_position(price, open_btc, fills):
    """Describe the currently open position (if any) for the dashboard, including
    stop-loss / take-profit levels derived from the bot's SL_PCT / TP_PCT."""
    if open_btc <= 1e-8:
        return None
    fb = last_buy(fills)
    entry = float(fb["price"]) if fb else price
    qty = round(open_btc, 6)
    sl = round(entry * (1 - SL_PCT), 2)
    tp = round(entry * (1 + TP_PCT), 2)
    risk = (entry - sl) * qty
    reward = (tp - entry) * qty
    return {
        "side": "LONG",
        "entry": round(entry, 2),
        "qty": qty,
        "mark_price": round(price, 2),
        "unrealized_pnl": round((price - entry) * qty, 2),
        "unrealized_pct": round((price / entry - 1) * 100, 2) if entry else 0.0,
        "stop_loss": sl,
        "take_profit": tp,
        "risk": round(risk, 2),
        "reward": round(reward, 2),
        "rr": round(reward / risk, 2) if risk else 0.0,
        "opened_at": fb["t"] if fb else None,
    }

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

# --- Strategy state (selected + tuned by the self-tuner) ---
STRATEGY = os.getenv("STRATEGY", "reversion")   # "reversion" | "breakout"
STRATEGY_PARAMS = {"entry_ceil": 45, "exit_rsi": 55}   # reversion defaults
# breakout defaults kept here for reference / when STRATEGY switches
BREAKOUT_PARAMS = {"lookback": 20, "vol_mult": 1.5}

def gen_signal(closes, vols, i, position, entry, held, p, strategy):
    """Unified entry/exit signal for a given strategy.
    Returns ("BUY"|"SELL"|"HOLD", reason). Shared SL/TP/time-stop on exits."""
    px = closes[i]
    if position == 0:
        if strategy == "reversion":
            r = rsi(closes[:i+1]); rp = rsi(closes[:i])
            if r < p["entry_ceil"] and rp <= r:
                return ("BUY", f"RSI {r:.0f} turn-up")
            lo = max(1, i-49)
            recent = [rsi(closes[max(0, j-13):j+1]) for j in range(lo, i+1)]
            if len(recent) >= 10 and rp <= r and r <= min(recent) + 3.0:
                return ("BUY", f"RSI near-low {r:.0f}")
            return ("HOLD", f"RSI {rsi(closes[:i+1]):.0f}")
        else:  # breakout / momentum
            lb = p.get("lookback", 20)
            if i < lb:
                return ("HOLD", "warmup")
            hi = max(closes[i-lb:i]); mh, ms, mhst = macd(closes[:i+1])
            mhst_prev = macd(closes[:i])[2]
            vol_ok = (vols[i] > vol_avg(vols, lb) * p.get("vol_mult", 1.5)) if i < len(vols) else True
            if px > hi and mhst > 0 and mhst >= mhst_prev and vol_ok:
                return ("BUY", f"breakout>{hi:.0f} vol")
            return ("HOLD", "no breakout")
    else:  # holding -> exit logic
        if px <= entry * (1 - SL_PCT):
            return ("SELL", f"STOP -{(1-px/entry)*100:.1f}%")
        if px >= entry * (1 + TP_PCT):
            return ("SELL", f"TP +{(px/entry-1)*100:.1f}%")
        if held >= MAX_HOLD:
            return ("SELL", f"TIME-STOP {held}c")
        if strategy == "reversion":
            if rsi(closes[:i+1]) >= p["exit_rsi"]:
                return ("SELL", f"RSI>={p['exit_rsi']}")
        else:
            lb = p.get("lookback", 20)
            if i >= lb and px < min(closes[i-lb:i]):
                return ("SELL", "breakdown")
            if macd(closes[:i+1])[2] < 0:
                return ("SELL", "MACD neg")
        return ("HOLD", f"hold {(px/entry-1)*100:+.1f}%")

def record_fill(side, qty, price, oid):
    with open(FILL_LOG, "a") as f:
        f.write(json.dumps({"t": dt.datetime.now().isoformat(), "side": side, "qty": qty, "price": price, "order": oid}) + "\n")

def load_fills():
    out=[]
    if os.path.exists(FILL_LOG):
        for ln in open(FILL_LOG):
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
    if not c.get("apiKey"):
        log("NO CREDENTIALS"); return
    try:
        price = demo_price()
        if price == 0:
            log("PRICE 0 - all price sources unreachable"); return
        kl = demo_get("/klines", {"symbol":SYMBOL,"interval":KL_INTERVAL,"limit":KL_LIMIT})
        if not isinstance(kl, list) or len(kl) < 15:
            log("KLINES too short"); return
        closes = [float(k[4]) for k in kl]
        vols = [float(k[5]) for k in kl]
        val = rsi(closes)
        acc = signed("/account", {})
        if not isinstance(acc, dict) or "balances" not in acc:
            log(f"ACCOUNT ERR {acc}"); return
        bal = {b["asset"]: float(b["free"]) for b in acc["balances"]}
        btc = bal.get("BTC",0.0); usdt = bal.get("USDT",0.0)
        p = STRATEGY_PARAMS

        if btc*price < DUST*price or btc < DUST:
            # FLAT (or only dust) — ask the active strategy for an entry; gate on recent edge
            sig, reason = gen_signal(closes, vols, len(closes)-1, 0, 0.0, 0, p, STRATEGY)
            recent = closes[-120:] if len(closes) >= 120 else closes
            eg = backtest_closes(recent, STRATEGY, p)
            edge_ok = bool(eg and eg["ret"] > 0 and eg["trades"] >= 1)
            if sig == "BUY" and edge_ok and usdt >= SIZE_MIN:
                notional = min(MAX_NOTIONAL, usdt*0.95)
                # MARKET BUY by quote: Binance computes qty from USDT spent.
                # Avoids manual qty rounding that triggered Binance -1013.
                o = signed("/order", {"symbol":SYMBOL,"side":"BUY","type":"MARKET",
                                      "quoteOrderQty": round(notional, 2)}, "POST")
                if isinstance(o, dict) and o.get("orderId"):
                    # derive executed qty/price from the fill for the ledger
                    ex = (o.get("fills") or [{}])[0]
                    qty = float(ex.get("qty", 0)); fill_px = float(ex.get("price", price))
                    bqty = fmt_qty(qty) if qty > 0 else fmt_qty(notional/price)
                    log(f"BUY[{STRATEGY}] qty={bqty} @ {fill_px:.2f} ({reason}) edge={eg['ret']:.1f}% -> {o['orderId']}")
                    record_fill("BUY", bqty, fill_px, o["orderId"])
                else: log(f"BUY FAILED {o}")
            else:
                log(f"HOLD (flat) [{STRATEGY}] sig={sig} edge_ok={edge_ok} ({reason})")
        else:
            # HOLDING — exit via gen_signal (SL/TP/time-stop + strategy exit)
            if btc < DUST:
                # only dust left (e.g. SELL rounding) — nothing to exit, skip to avoid 400
                log(f"HOLD (dust {btc:.6f} BTC) — no exit")
            else:
                fb = last_buy(load_fills())
                entry = float(fb["price"]) if fb else price
                held = int((dt.datetime.now() - dt.datetime.fromisoformat(fb["t"])).total_seconds()/60/_interval_minutes()) if fb else 0
                sig, reason = gen_signal(closes, vols, len(closes)-1, 1, entry, held, p, STRATEGY)
                if sig == "SELL":
                    sq = fmt_qty(btc)
                    o = signed("/order", {"symbol":SYMBOL,"side":"SELL","type":"MARKET","quantity":sq}, "POST")
                    if isinstance(o, dict) and o.get("orderId"):
                        log(f"SELL[{STRATEGY}] qty={sq} @ {price:.2f} ({reason}) -> {o['orderId']}")
                        record_fill("SELL", sq, price, o["orderId"])
                    else: log(f"SELL FAILED {o}")
                else:
                    log(f"HOLD (in pos) [{STRATEGY}] RSI={val:.1f} PnL={(price/entry-1)*100:+.1f}% held={held}c ({reason})")
    except Exception as e:
        log(f"TICK ERROR {e}")

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

def _day_key(iso):
    return iso[:10]  # YYYY-MM-DD

def portfolio_analytics(fills, price):
    """Compute total / day / yesterday / week P&L from the fills ledger."""
    # cash-flow reconstruction: track BTC position and realized P&L per fill
    btc_pos = 0.0
    realized_total = 0.0
    # per-day gross gain and loss (realized) and open-mark deltas
    day_gain = {}   # date -> positive realized
    day_loss = {}   # date -> negative realized (abs)
    day_pnl  = {}   # date -> net realized
    for f in fills:
        d = _day_key(f["t"])
        p = float(f["price"]) * float(f["qty"])
        if f["side"] == "BUY":
            btc_pos += float(f["qty"])
            realized_total -= p
            day_pnl[d] = day_pnl.get(d, 0.0) - p
        else:
            btc_pos -= float(f["qty"])
            realized_total += p
            day_pnl[d] = day_pnl.get(d, 0.0) + p
    for d, v in day_pnl.items():
        if v >= 0: day_gain[d] = day_gain.get(d, 0.0) + v
        else:      day_loss[d] = day_loss.get(d, 0.0) + abs(v)

    today = dt.datetime.now().strftime("%Y-%m-%d")
    y = dt.datetime.now() - dt.timedelta(days=1)
    yesterday = y.strftime("%Y-%m-%d")
    week_ago = (dt.datetime.now() - dt.timedelta(days=7)).strftime("%Y-%m-%d")

    def sum_range(start, end):
        g = sum(v for d, v in day_gain.items() if start <= d <= end)
        l = sum(v for d, v in day_loss.items() if start <= d <= end)
        return g, l, g - l

    # week = last 7 days inclusive of today
    wk_gain, wk_loss, wk_net = sum_range(week_ago, today)
    today_gain = day_gain.get(today, 0.0)
    today_loss = day_loss.get(today, 0.0)
    today_net = day_pnl.get(today, 0.0)
    y_gain = day_gain.get(yesterday, 0.0)
    y_loss = day_loss.get(yesterday, 0.0)
    y_net = day_pnl.get(yesterday, 0.0)

    return {
        "realized_total": round(realized_total, 2),
        "today_gain": round(today_gain, 2),
        "today_loss": round(today_loss, 2),
        "today_net": round(today_net, 2),
        "yesterday_gain": round(y_gain, 2),
        "yesterday_loss": round(y_loss, 2),
        "yesterday_net": round(y_net, 2),
        "week_gain": round(wk_gain, 2),
        "week_loss": round(wk_loss, 2),
        "week_net": round(wk_net, 2),
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

def make_state():
    fills = load_fills()
    spent=gained=0.0; btc_bal=0.0
    for f in fills:
        if f["side"]=="BUY": spent+=f["qty"]*f["price"]; btc_bal+=f["qty"]
        else: gained+=f["qty"]*f["price"]; btc_bal-=f["qty"]
    price = demo_price()
    acc = signed("/account", {})
    usdt=0.0; live_btc=0.0
    if isinstance(acc, dict):
        for b in acc.get("balances", []):
            if b["asset"]=="USDT": usdt=float(b["free"])
            if b["asset"]=="BTC": live_btc=float(b["free"])
    open_btc = live_btc if abs(live_btc - btc_bal) > DUST else btc_bal
    if open_btc < DUST:
        open_btc = 0.0
    unreal = open_btc*price; realized = gained-spent
    total_funds = usdt + unreal
    equity=[]; rb=0.0; ru=0.0
    for f in fills:
        if f["side"]=="BUY": rb+=f["qty"]; ru-=f["qty"]*f["price"]
        else: rb-=f["qty"]; ru+=f["qty"]*f["price"]
        equity.append({"t":f["t"],"equity":round(ru+rb*price,2)})
    equity.append({"t":dt.datetime.now().isoformat(),"equity":round(total_funds,2)})
    pa = portfolio_analytics(fills, price)
    return {
        "symbol":SYMBOL,"price":price,"usdt":round(usdt,2),
        "btc_open":round(open_btc,6),"open_value":round(unreal,2),
        "realized":round(realized,2),"net_pnl":round(realized+unreal,2),
        "total_funds":round(total_funds,2),
        "fills":len(fills),"round_trips":len([f for f in fills if f["side"]=="SELL"]),
        "equity_curve":equity,"portfolio":pa,
        "strategy": STRATEGY,
        "strategy_params": STRATEGY_PARAMS,
        "position": _open_position(price, open_btc, fills),
        "tune": load_tune(),
        "creds_loaded": bool(creds().get("apiKey")),
        "updated":dt.datetime.now().isoformat(),
    }

class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        data = body.encode() if isinstance(body,str) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type",ctype)
        self.send_header("Content-Length",str(len(data)))
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Methods","GET, OPTIONS")
        self.end_headers(); self.wfile.write(data)
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Methods","GET, OPTIONS")
        self.end_headers()
    def do_GET(self):
        if self.path in ("/api/state",):
            self._send(200, make_state())
        elif self.path in ("/api/price",):
            # lightweight, fast: price + position only (no signed /account call),
            # so the frontend's 2s poll stays near-real-time.
            try:
                price = demo_price()
                self._send(200, {"price": price, "updated": dt.datetime.now().isoformat()})
            except Exception as e:
                self._send(500, {"error": str(e)})
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

        elif self.path in ("/", "/index.html"):
            fpath = os.path.join(HERE, "static", "index.html")
            if os.path.exists(fpath):
                self._send(200, open(fpath).read(), "text/html")
            else:
                self._send(200, "<h1>Paper Trader API</h1><p>/api/state /api/fills</p>", "text/html")
        else:
            self._send(404, {"error":"not found"})

    def log_message(self, *a): pass

if __name__ == "__main__":
    threading.Thread(target=trader_loop, daemon=True).start()
    log(f"API on :{PORT}")
    HTTPServer(("0.0.0.0", PORT), H).serve_forever()
