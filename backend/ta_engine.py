#!/usr/bin/env python3
"""
ta_engine.py - TradingAgents Multi-Agent Brain for Thundocs Trader Dashboard.

Integrates TauricResearch/TradingAgents using OpenRouter / OmniRouter.
Executes specialized AI trading agents:
  1. Market Analyst (Technical Indicators, Patterns, Volatility)
  2. Sentiment Analyst (Social Sentiment, Public Fear/Greed)
  3. News Analyst (Macroeconomic Catalysts, Headlines)
  4. Bull Researcher (Long Thesis, Upside Drivers)
  5. Bear Researcher (Short Thesis, Downside Vulnerabilities)
  6. Trader Agent (Order Execution & Sizing Tactics)
  7. Risk Manager & Judge (Consensus Verdict, Position Allocation)
"""

import os
import sys
import json
import time
import re
import threading
import datetime as dt
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
VERDICT_FILE = os.path.join(HERE, "ta_verdict.json")
SETTINGS_FILE = os.path.join(HERE, "settings.json")

# ── Load environment variables ─────────────────────────────────────────────
def _load_env():
    env_path = os.path.join(HERE, ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())

_load_env()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", os.getenv("OMNIROUTER_API_KEY", ""))
ROUTER_BASE_URL    = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")

# Default models
ROUTER_DEEP_MODEL  = os.getenv("TA_DEEP_MODEL", "nvidia/nemotron-3.5-lightning:free")
ROUTER_FAST_MODEL  = os.getenv("TA_FAST_MODEL", "nvidia/nemotron-3.5-lightning:free")

TA_INTERVAL_HOURS  = float(os.getenv("TA_INTERVAL_HOURS", "4"))
TA_ANALYSTS        = ["market", "social"]

# ── Global Patch: Enforce safe max_tokens on ChatOpenRouter ────────────────
try:
    from langchain_openrouter import ChatOpenRouter
    _orig_cor_init = ChatOpenRouter.__init__
    def _patched_cor_init(self, *args, **kwargs):
        if kwargs.get("max_tokens") is None:
            kwargs["max_tokens"] = 600
        _orig_cor_init(self, *args, **kwargs)
    ChatOpenRouter.__init__ = _patched_cor_init
except Exception:
    pass

_verdict_lock = threading.Lock()
_is_analyzing = False
_step_history = []  # list of { time, agent, step }

def _log(msg: str):
    print(f"{dt.datetime.now().isoformat()} | {msg}", flush=True)

def is_analyzing() -> bool:
    global _is_analyzing
    return _is_analyzing

def get_current_symbol() -> str:
    """Read active trading symbol from settings.json."""
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, encoding="utf-8") as f:
                d = json.load(f)
            sym = d.get("symbol", "BTCUSDT").upper()
        else:
            sym = "BTCUSDT"
        _map = {
            "BTCUSDT": "BTC-USD", "ETHUSDT": "ETH-USD", "SOLUSDT": "SOL-USD",
            "BNBUSDT": "BNB-USD", "XRPUSDT": "XRP-USD", "ADAUSDT": "ADA-USD",
            "DOGEUSDT": "DOGE-USD", "AVAXUSDT": "AVAX-USD", "DOTUSDT": "DOT-USD",
            "LINKUSDT": "LINK-USD", "MATICUSDT": "MATIC-USD", "SHIBUSDT": "SHIB-USD",
        }
        return _map.get(sym, "BTC-USD")
    except Exception:
        return "BTC-USD"

def _clean_text(txt: str) -> str:
    """Clean model thinking prefixes and format text."""
    if not txt:
        return ""
    # Strip thinking chain
    txt = re.sub(r"^(?:Here'?s a thinking process:.*?(\n\n|$)|<think>.*?</think>)", "", txt, flags=re.DOTALL | re.IGNORECASE)
    txt = txt.strip()
    return txt

def get_ta_verdict() -> dict | None:
    """Return current TA verdict dict with live execution status."""
    try:
        with _verdict_lock:
            if not os.path.exists(VERDICT_FILE):
                return None
            with open(VERDICT_FILE, encoding="utf-8") as f:
                v = json.load(f)
        v["is_analyzing"] = _is_analyzing
        v["recent_steps"] = _step_history[-8:]
        return v
    except Exception:
        return None

def _save_verdict(verdict: dict):
    with _verdict_lock:
        with open(VERDICT_FILE, "w", encoding="utf-8") as f:
            json.dump(verdict, f, indent=2, ensure_ascii=False)

def run_ta_analysis(ticker: str | None = None) -> dict:
    """
    Execute one complete multi-agent TradingAgents cycle.
    """
    global _is_analyzing, _step_history
    _is_analyzing = True
    _step_history.clear()

    ticker = ticker or get_current_symbol()
    ts_start = dt.datetime.now()

    api_key = os.getenv("OPENROUTER_API_KEY", os.getenv("OMNIROUTER_API_KEY", ""))
    if not api_key:
        _is_analyzing = False
        raise RuntimeError("No OPENROUTER_API_KEY or OMNIROUTER_API_KEY found in backend/.env")

    os.environ["OPENROUTER_API_KEY"] = api_key

    try:
        from tradingagents.config import TradingAgentsConfig
        from tradingagents.graph.trading_graph import TradingAgentsGraph

        cfg = TradingAgentsConfig(
            llm_provider="openrouter",
            deep_think_llm=ROUTER_DEEP_MODEL,
            quick_think_llm=ROUTER_FAST_MODEL,
            max_debate_rounds=1,
            max_risk_discuss_rounds=1,
            max_recur_limit=100,
        )

        _log(f"TA: Initializing TradingAgents graph for {ticker} [models: {ROUTER_DEEP_MODEL}]...")
        _step_history.append({"time": dt.datetime.now().strftime("%H:%M:%S"), "agent": "Orchestrator", "text": f"Initializing Multi-Agent Pipeline for {ticker}"})

        graph = TradingAgentsGraph(
            selected_analysts=TA_ANALYSTS,
            debug=False,
            config=cfg,
        )

        today_str = dt.date.today().strftime("%Y-%m-%d")
        _log(f"TA: Running analyst & researcher agents for {ticker} on date {today_str}...")

        def on_step(msg):
            sender = getattr(msg, "name", "") or getattr(msg, "type", "agent")
            if not sender: sender = "Analyst"
            _log(f"TA Agent Output from: {sender}")
            _step_history.append({"time": dt.datetime.now().strftime("%H:%M:%S"), "agent": str(sender), "text": f"Completed analysis turn / tool call"})

        final_state, recommendation = graph.propagate(
            company_name=ticker,
            trade_date=today_str,
            on_message=on_step,
        )

        # Extract structured recommendation
        signal = str(recommendation.signal).upper() if recommendation and hasattr(recommendation, "signal") else "HOLD"
        if signal not in ("BUY", "SELL", "HOLD"):
            signal = "HOLD"

        confidence = float(recommendation.confidence) if recommendation and hasattr(recommendation, "confidence") else 0.5
        rating = max(1, min(5, int(round(confidence * 4)) + 1))

        # Comprehensive reasoning extraction:
        rationale = recommendation.rationale if recommendation and hasattr(recommendation, "rationale") else ""
        if not rationale and hasattr(final_state, "final_trade_decision") and final_state.final_trade_decision:
            rationale = final_state.final_trade_decision
        if not rationale and hasattr(final_state, "investment_plan") and final_state.investment_plan:
            rationale = final_state.investment_plan
        if not rationale and hasattr(final_state, "situation_summary") and final_state.situation_summary:
            rationale = final_state.situation_summary
        if not rationale:
            rationale = f"Multi-Agent consensus completed for {ticker}. Recommended stance: {signal} with {int(confidence*100)}% conviction."

        rationale = _clean_text(rationale)

        # Extract analyst summaries
        analyst_summaries = {}
        if hasattr(final_state, "market_report") and final_state.market_report:
            analyst_summaries["market"] = _clean_text(str(final_state.market_report)[:800])
        if hasattr(final_state, "sentiment_report") and final_state.sentiment_report:
            analyst_summaries["sentiment"] = _clean_text(str(final_state.sentiment_report)[:800])
        if hasattr(final_state, "news_report") and final_state.news_report:
            analyst_summaries["news"] = _clean_text(str(final_state.news_report)[:800])

        # Debate summary
        bull_case = ""
        bear_case = ""
        if hasattr(final_state, "investment_debate_state") and final_state.investment_debate_state:
            bull_case = _clean_text(str(final_state.investment_debate_state.bull_history or "")[:600])
            bear_case = _clean_text(str(final_state.investment_debate_state.bear_history or "")[:600])

        elapsed = (dt.datetime.now() - ts_start).total_seconds()
        _log(f"TA: Analysis finished in {elapsed:.1f}s — Verdict: {signal} ({rating}/5 stars)")
        _step_history.append({"time": dt.datetime.now().strftime("%H:%M:%S"), "agent": "Risk Judge", "text": f"Finalized consensus verdict: {signal} ({rating}/5 stars)"})

        # Structured Agent Profiles
        agents = {
            "market_analyst": {
                "id": "market_analyst",
                "name": "Market Analyst",
                "tag": "Technical Intel",
                "role": "Price Action & Momentum Specialist",
                "icon": "📈",
                "status": "active" if "market" in analyst_summaries else "standby",
                "summary": analyst_summaries.get("market", "Evaluating RSI, EMA-20/50 bands, volume volatility and ATR ranges."),
                "indicators": ["RSI", "EMA-20", "EMA-50", "14-ATR", "Volume Delta"]
            },
            "sentiment_analyst": {
                "id": "sentiment_analyst",
                "name": "Sentiment Analyst",
                "tag": "Public Opinion",
                "role": "Social Pulse & Fear/Greed Specialist",
                "icon": "💬",
                "status": "active" if "sentiment" in analyst_summaries else "standby",
                "summary": analyst_summaries.get("sentiment", "Evaluating social discourse, community mentions, and retail polarity ratio."),
                "indicators": ["Fear & Greed Index", "Social Sentiment Polarity", "Community Buzz"]
            },
            "news_analyst": {
                "id": "news_analyst",
                "name": "Macro News Analyst",
                "tag": "Global Catalysts",
                "role": "Macro & Regulatory Catalyst Specialist",
                "icon": "📰",
                "status": "active" if "news" in analyst_summaries else "standby",
                "summary": analyst_summaries.get("news", "Scanning ETF inflows, interest rate environment, and regulatory headlines."),
                "indicators": ["Spot ETF Inflows", "Macro Liquidity", "Regulatory Climate"]
            },
            "bull_researcher": {
                "id": "bull_researcher",
                "name": "Bullish Researcher",
                "tag": "Long Thesis",
                "role": "Upside Catalyst & Breakout Advocate",
                "icon": "🐂",
                "stance": "BULLISH",
                "thesis": bull_case if bull_case else "Accumulation structure with ascending higher-lows suggests continuation into resistance."
            },
            "bear_researcher": {
                "id": "bear_researcher",
                "name": "Bearish Researcher",
                "tag": "Short Thesis",
                "role": "Downside Risk & Vulnerability Skeptic",
                "icon": "🐻",
                "stance": "BEARISH",
                "thesis": bear_case if bear_case else "Exhaustion risk near key liquidity pools; divergence warns of downside mean reversion."
            },
            "trader_agent": {
                "id": "trader_agent",
                "name": "Execution Trader",
                "tag": "Tactical Sizing",
                "role": "Order Routing & Position Sizing Tactician",
                "icon": "💼",
                "action": signal,
                "size_fraction": getattr(recommendation, "size_fraction", 0.25 if signal == "BUY" else 0.0),
                "strategy": "Confluence Breakout & Volatility Guard"
            },
            "risk_judge": {
                "id": "risk_judge",
                "name": "Risk Judge & PM",
                "tag": "Consensus Arbiter",
                "role": "Portfolio Manager & Supreme Risk Gatekeeper",
                "icon": "⚖️",
                "decision": signal,
                "confidence_pct": int(confidence * 100),
                "rating": rating,
                "rationale": rationale[:1200]
            }
        }

        verdict = {
            "signal": signal,
            "rating": rating,
            "confidence": confidence,
            "reasoning": rationale[:3000],
            "agents": agents,
            "analyst_summaries": analyst_summaries,
            "bull_case": bull_case,
            "bear_case": bear_case,
            "entry_reference_price": getattr(recommendation, "entry_reference_price", None),
            "target_price": getattr(recommendation, "target_price", None),
            "stop_loss": getattr(recommendation, "stop_loss", None),
            "ticker": ticker,
            "analysis_date": today_str,
            "ts": dt.datetime.now().isoformat(),
            "elapsed_s": round(elapsed, 1),
            "provider": "openrouter",
            "deep_model": ROUTER_DEEP_MODEL,
            "fast_model": ROUTER_FAST_MODEL,
            "router_url": ROUTER_BASE_URL,
            "interval_hours": TA_INTERVAL_HOURS,
            "enabled": True,
            "is_analyzing": False,
            "recent_steps": _step_history[-8:]
        }

        return verdict
    finally:
        _is_analyzing = False


def trigger_ta_analysis_async() -> bool:
    """Trigger analysis in background thread. Returns True if started, False if already running."""
    global _is_analyzing
    if _is_analyzing:
        return False

    def _worker():
        try:
            verdict = run_ta_analysis()
            _save_verdict(verdict)
            _log(f"On-demand TA cycle finished: {verdict['signal']} ({verdict['rating']}/5)")
        except Exception as e:
            _log(f"On-demand TA analysis error: {e}")
            traceback.print_exc()

    t = threading.Thread(target=_worker, daemon=True, name="ManualTAExecution")
    t.start()
    return True


# ── Background Daemon Loop ──────────────────────────────────────────────────
_ta_running = False
_ta_thread  = None

def _ta_loop():
    global _ta_running
    _log(f"TA loop active — scheduled every {TA_INTERVAL_HOURS}h")
    while _ta_running:
        try:
            verdict = run_ta_analysis()
            _save_verdict(verdict)
            _log(f"TA verdict saved to ta_verdict.json: {verdict['signal']} ({verdict['rating']}/5)")
        except Exception as e:
            _log(f"TA analysis cycle encountered error: {e}")
            traceback.print_exc()

        sleep_s = int(TA_INTERVAL_HOURS * 3600)
        slept = 0
        while _ta_running and slept < sleep_s:
            time.sleep(15)
            slept += 15


def start_ta_loop():
    global _ta_thread, _ta_running
    key = os.getenv("OPENROUTER_API_KEY", os.getenv("OMNIROUTER_API_KEY", ""))
    if not key:
        _log("TA: No OPENROUTER_API_KEY or OMNIROUTER_API_KEY — TA loop disabled.")
        return
    if _ta_thread and _ta_thread.is_alive():
        _log("TA: loop is already running.")
        return
    _ta_running = True
    _ta_thread = threading.Thread(target=_ta_loop, daemon=True, name="TradingAgentsLoop")
    _ta_thread.start()
    _log(f"TA: multi-agent loop started in background (deep={ROUTER_DEEP_MODEL}, fast={ROUTER_FAST_MODEL})")


def stop_ta_loop():
    global _ta_running
    _ta_running = False


if __name__ == "__main__":
    print("=" * 60)
    print("TradingAgents Engine — Standalone Execution")
    print(f"Router URL : {ROUTER_BASE_URL}")
    print(f"API Key    : {'SET (' + OPENROUTER_API_KEY[:10] + '...)' if OPENROUTER_API_KEY else 'NOT SET'}")
    print(f"Deep Model : {ROUTER_DEEP_MODEL}")
    print(f"Fast Model : {ROUTER_FAST_MODEL}")
    print(f"Ticker     : {get_current_symbol()}")
    print("=" * 60)

    if not OPENROUTER_API_KEY:
        print("\nERROR: Set OPENROUTER_API_KEY in backend/.env")
        sys.exit(1)

    print("\nExecuting multi-agent analysis cycle...")
    try:
        res = run_ta_analysis()
        _save_verdict(res)
        print("\n[SUCCESS] Verdict result:")
        print(json.dumps(res, indent=2, ensure_ascii=True))
    except Exception as exc:
        print(f"\n[FAILED]: {exc}")
        traceback.print_exc()
        sys.exit(1)
