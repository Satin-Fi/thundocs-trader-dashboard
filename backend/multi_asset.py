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
        "pnl_by_actor": pnl_by_actor(fills, prices)
    }

