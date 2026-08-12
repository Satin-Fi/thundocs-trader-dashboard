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
RSI_LOW, RSI_HIGH = 30, 70
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

def tick():
    c = creds()
    if not c.get("apiKey"):
        log("NO CREDENTIALS"); return
    try:
        price = demo_price()
        if price == 0:
            log("PRICE 0 - all price sources unreachable"); return
        kl = demo_get("/klines", {"symbol":SYMBOL,"interval":KL_INTERVAL,"limit":20})
        val = rsi([float(k[4]) for k in kl])
        acc = signed("/account", {})
        if not isinstance(acc, dict) or "balances" not in acc:
            log(f"ACCOUNT ERR {acc}"); return
        bal = {b["asset"]: float(b["free"]) for b in acc["balances"]}
        btc = bal.get("BTC",0.0); usdt = bal.get("USDT",0.0)
        if val < RSI_LOW and btc*price < 1e-4:
            notional = min(MAX_NOTIONAL, usdt*0.95); qty = max(0.0001, round((notional/price)/0.00001)*0.00001)
            if qty*price >= 10:
                o = signed("/order", {"symbol":SYMBOL,"side":"BUY","type":"MARKET","quantity":round(qty,5)}, "POST")
                oid = o.get("orderId", o); log(f"BUY qty={round(qty,5)} -> {oid}"); record_fill("BUY", round(qty,5), price, oid)
            else: log(f"BUY skipped qty too small {qty:.5f}")
        elif val > RSI_HIGH and btc > 1e-4:
            o = signed("/order", {"symbol":SYMBOL,"side":"SELL","type":"MARKET","quantity":round(btc,6)}, "POST")
            oid = o.get("orderId", o); log(f"SELL qty={btc} -> {oid}"); record_fill("SELL", round(btc,6), price, oid)
        else: log("HOLD")
    except Exception as e:
        log(f"TICK ERROR {e}")

def trader_loop():
    log("trader loop started")
    while True:
        tick()
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
