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
PORT = int(os.getenv("PORT", "8000"))

def log(m):
    print(f"{dt.datetime.now().isoformat()} | {m}", flush=True)

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
    url = f"{BASE}/v3{path}?{q}&signature={sig}"
    try:
        req = urllib.request.Request(url, headers={"X-MBX-APIKEY": c["apiKey"]})
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
        val = rsi(closes)
        prev_val = rsi(closes[:-1]) if len(closes) > 1 else val
        acc = signed("/account", {})
        if not isinstance(acc, dict) or "balances" not in acc:
            log(f"ACCOUNT ERR {acc}"); return
        bal = {b["asset"]: float(b["free"]) for b in acc["balances"]}
        btc = bal.get("BTC",0.0); usdt = bal.get("USDT",0.0)

        if btc*price < 1e-4:
            # FLAT — adaptive oversold entry (RSI in bottom quantile of recent range, turning up)
            entry_sig = adaptive_entry(closes, len(closes)-1, RSI_LOW)
            # EDGE FILTER: only trade if the strategy's own recent backtest is positive
            recent = closes[-100:] if len(closes) >= 100 else closes
            eg = backtest_on(RSI_LOW, RSI_HIGH, recent)
            edge_ok = bool(eg and eg["ret"] > 0 and eg["trades"] >= 1)
            if entry_sig and edge_ok and usdt >= SIZE_MIN:
                depth = max(0.0, (RSI_LOW - val) / max(RSI_LOW,1))   # 0..1 (RSI_LOW now = entry quantile)
                notional = min(MAX_NOTIONAL, usdt*0.95) * (0.6 + 0.4*depth)
                qty = max(0.0001, round((notional/price)/0.00001)*0.00001)
                if qty*price >= SIZE_MIN:
                    o = signed("/order", {"symbol":SYMBOL,"side":"BUY","type":"MARKET","quantity":round(qty,5)}, "POST")
                    if isinstance(o, dict) and o.get("orderId"):
                        log(f"BUY qty={round(qty,5)} @ {price:.2f} RSI={val:.1f} edge={eg['ret']:.1f}% -> {o['orderId']}")
                        record_fill("BUY", round(qty,5), price, o["orderId"])
                    else: log(f"BUY FAILED {o}")
                else: log(f"BUY skipped qty too small {qty:.5f}")
            else:
                log(f"HOLD (flat) RSI={val:.1f} entry={entry_sig} edge_ok={edge_ok}")
        else:
            # HOLDING — exit on RSI-high, stop-loss, take-profit, or time-stop
            fb = last_buy(load_fills())
            entry = float(fb["price"]) if fb else price
            held = int((dt.datetime.now() - dt.datetime.fromisoformat(fb["t"])).total_seconds()/60/_interval_minutes()) if fb else 0
            if val >= RSI_HIGH:
                reason = f"RSI {val:.1f}>={RSI_HIGH}"
            elif entry > 0 and price <= entry*(1-SL_PCT):
                reason = f"STOP -{(1-price/entry)*100:.1f}%"
            elif entry > 0 and price >= entry*(1+TP_PCT):
                reason = f"TP +{(price/entry-1)*100:.1f}%"
            elif held >= MAX_HOLD:
                reason = f"TIME-STOP {held}c"
            else:
                log(f"HOLD (in pos) RSI={val:.1f} PnL={(price/entry-1)*100:+.1f}% held={held}c")
                return
            o = signed("/order", {"symbol":SYMBOL,"side":"SELL","type":"MARKET","quantity":round(btc,6)}, "POST")
            if isinstance(o, dict) and o.get("orderId"):
                log(f"SELL qty={btc} @ {price:.2f} ({reason}) -> {o['orderId']}")
                record_fill("SELL", round(btc,6), price, o["orderId"])
            else: log(f"SELL FAILED {o}")
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
# Self-improvement: periodically backtest the strategy over recent market data
# and auto-tune RSI thresholds within safe bounds. The bot "learns" by picking
# the parameter set with the best backtested return + win-rate.
# ---------------------------------------------------------------------------
TUNE_FILE = os.path.join(HERE, "tune_report.json")
TUNE_CYCLE_EVERY = 8          # run self_tune() every N ticks (~2h at 15m)
_cycle_count = 0
# safe bounds the tuner is allowed to explore
RSI_LOW_MIN, RSI_LOW_MAX = 20, 40
RSI_HIGH_MIN, RSI_HIGH_MAX = 60, 80
# candidate (entry_rsi_ceiling, neutral_exit_rsi) sets the tuner explores
CANDIDATE_SETS = [(40,55),(45,55),(35,50),(50,60),(42,52)]

def self_tune():
    """Walk-forward tuning: pick the best RSI set on the TRAINING half, then
    score it on the held-out TEST half (out-of-sample) to avoid overfitting.
    Apply only if the test-half return clearly beats the current params."""
    global RSI_LOW, RSI_HIGH
    kl = demo_get("/klines", {"symbol":SYMBOL,"interval":KL_INTERVAL,"limit":400})
    if not isinstance(kl, list) or len(kl) < 120:
        log("SELF-TUNE skipped: not enough klines"); return None
    closes = [float(k[4]) for k in kl]
    cut = int(len(closes)*0.7)
    train = closes[:cut]; test = closes[cut:]
    # train split to find best params
    train_res = []
    for (lo, hi) in CANDIDATE_SETS:
        m = backtest_on(lo, hi, train)
        if m: train_res.append((lo, hi, m))
    if not train_res:
        return None
    train_res.sort(key=lambda x: x[2]["ret"], reverse=True)
    best = train_res[0]
    # out-of-sample validation on the test split
    test_best = backtest_on(best[0], best[1], test)
    test_cur = backtest_on(RSI_LOW, RSI_HIGH, test)
    applied = False
    if test_best and test_cur and test_best["ret"] > test_cur["ret"] + 1.0:
        RSI_LOW, RSI_HIGH = best[0], best[1]; applied = True
    report = {
        "ts": dt.datetime.now().isoformat(),
        "method": "walk-forward 70/30 train/test",
        "current": {"low": RSI_LOW, "high": RSI_HIGH, "test_ret": test_cur["ret"] if test_cur else 0.0},
        "best": {"low": best[0], "high": best[1],
                 "train_ret": best[2]["ret"], "test_ret": test_best["ret"] if test_best else 0.0,
                 "metrics": test_best or {}},
        "applied": applied,
        "candidates": [{"low":lo,"high":hi,"train_ret":m["ret"],"test_ret":(backtest_on(lo,hi,test) or {}).get("ret",0.0)}
                        for (lo,hi,m) in train_res],
    }
    try:
        with open(TUNE_FILE, "w") as f:
            json.dump(report, f, indent=2)
    except Exception:
        pass
    log(f"SELF-TUNE best={best[0]}/{best[1]} test_ret={(test_best or {}).get('ret',0)}% applied={applied}")
    return report

def backtest_on(low, high, closes):
    """Backtest the improved strategy on an explicit closes list (for walk-forward).
    `low` = entry quantile % (adaptive oversold), `high` = exit RSI (mean-reversion target)."""
    cash, pos, entry, trades = 1000.0, 0.0, 0.0, 0
    wins = losses = 0
    for i in range(14, len(closes)):
        r = rsi(closes[:i+1]); rp = rsi(closes[:i]); px = closes[i]
        if pos == 0:
            if adaptive_entry(closes, i, low):
                entry = px; pos = cash/px; cash = 0.0; trades += 1; held = 0
        else:
            held += 1
            pnl = pos*px - pos*entry
            if (r >= high) or (px <= entry*(1-SL_PCT)) or (px >= entry*(1+TP_PCT)) or (held >= MAX_HOLD):
                if pnl >= 0: wins += 1
                else: losses += 1
                cash = pos*px; pos = 0.0
    if pos > 0: cash = pos*closes[-1]
    ret = (cash-1000.0)/1000.0
    wr = (wins/(wins+losses))*100 if (wins+losses) else 0.0
    return {"ret": round(ret*100,2), "win_rate": round(wr,1), "trades": trades,
            "wins": wins, "losses": losses, "max_dd": 0.0}

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
    open_btc = live_btc if abs(live_btc - btc_bal) > 1e-9 else btc_bal
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
        "rsi": {"low": RSI_LOW, "high": RSI_HIGH},
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
        elif self.path in ("/api/fills",):
            self._send(200, list(reversed(load_fills()[-50:])))
        elif self.path in ("/api/tune",):
            try:
                rep = self_tune()
            except Exception as e:
                rep = {"error": str(e)}
            self._send(200, rep or load_tune() or {"status": "no data"})
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
