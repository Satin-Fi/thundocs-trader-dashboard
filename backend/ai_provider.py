"""
ai_provider.py — free, provider-agnostic AI verdict for trading decisions.

The bot's core signals come from technical indicators (RSI, S/R, regime). This
module adds a SECOND OPINION from a free LLM so the bot can sanity-check its
own signal before risking capital. No paid plans required — every provider
below has a free tier (free API token, no card):

  1. OpenRouter  (OPENROUTER_API_KEY) — free models: llama-3.1-8b-instruct:free,
     gemma-2-7b-it:free, mistral-7b-instruct:free, etc. MOST RELIABLE free tier.
  2. Groq        (GROQ_API_KEY)       — free tier: llama-3.1-8b-instant, etc.
  3. HuggingFace (HF_TOKEN)            — serverless inference (best-effort).
  4. Local heuristic fallback          — always works, no network/key needed.

If no key is configured, the bot transparently uses the local heuristic and
labels the verdict accordingly so the dashboard never lies about "AI".
"""
import os
import json
import urllib.request
import urllib.error
from datetime import datetime

# Load .env explicitly so AI keys work whether the process inherited them
# from the shell or not (app.py itself does not parse .env).
def _load_env():
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass
    # Manual fallback: parse backend/.env if dotenv missing.
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(p):
        try:
            for line in open(p, encoding="utf-8"):
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and not os.getenv(k):
                    os.environ[k] = v
        except Exception:
            pass

_load_env()

TIMEOUT = int(os.getenv("AI_TIMEOUT", "25"))


def _post_json(url, headers, payload, timeout=TIMEOUT):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers=headers, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _openrouter(prompt, model=None):
    key = os.getenv("OPENROUTER_API_KEY")
    if not key:
        return None
    # Free `:free` slugs rotate rate-limits; try a priority list so one being
    # 429'd falls through to the next working free model.
    models = [model] if model else []
    models += [
        "nvidia/nemotron-3-super-120b-a12b:free",
        "minimax/minimax-m2.7:free",
        "z-ai/glm-5.2:free",
        "google/gemma-4-31b-it:free",
        "cohere/north-mini-code:free",
        "liquid/lfm-2.5-2.6b:free",
    ]
    last_err = None
    for m in models:
        try:
            data = _post_json(
                "https://openrouter.ai/api/v1/chat/completions",
                {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {key}",
                    "HTTP-Referer": "https://thundocs-trader-dashboard",
                    "X-Title": "PaperTrader-AI",
                },
                {"model": m, "messages": [{"role": "user", "content": prompt}],
                 "max_tokens": 120, "temperature": 0.2},
            )
            txt = data["choices"][0]["message"]["content"].strip()
            if txt:
                return txt
        except Exception as e:
            last_err = e
            continue
    return None


def _groq(prompt, model):
    key = os.getenv("GROQ_API_KEY")
    if not key:
        return None
    try:
        data = _post_json(
            "https://api.groq.com/openai/v1/chat/completions",
            {"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
            {"model": model, "messages": [{"role": "user", "content": prompt}],
             "max_tokens": 120, "temperature": 0.2},
        )
        return data["choices"][0]["message"]["content"].strip()
    except Exception:
        return None


def _huggingface(prompt):
    key = os.getenv("HF_TOKEN")
    if not key:
        return None
    # Native HF serverless text-generation route (works with free tokens;
    # the /v1/chat/completions sub-path is unreliable on serverless).
    try:
        data = _post_json(
            "https://api-inference.huggingface.co/models/meta-llama/Llama-3.2-3B-Instruct",
            {"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
            {"inputs": prompt, "parameters": {"max_new_tokens": 120, "temperature": 0.2,
                                              "return_full_text": False}},
        )
        if isinstance(data, list) and data:
            txt = data[0].get("generated_text", "")
        elif isinstance(data, dict):
            txt = data.get("generated_text", "")
        else:
            txt = ""
        return txt.strip() or None
    except Exception:
        return None


def _heuristic(signal, ctx):
    """Offline fallback: a transparent rule-based second opinion.

    Returns (verdict, reason, provider). Never throws.
    """
    rsi = ctx.get("rsi")
    regime = (ctx.get("regime") or "").lower()
    position = (ctx.get("position") or "").lower()
    reasons = []

    # Conflicting signals → reject by default (capital preservation).
    if signal == "BUY":
        if rsi is not None and rsi > 70:
            return "REJECT", "Heuristic: RSI %.0f overbought — BUY rejected." % rsi, "heuristic"
        if regime == "bear" and position != "flat":
            return "REJECT", "Heuristic: bear regime + already in position.", "heuristic"
        reasons.append("RSI %.0f not overbought" % (rsi if rsi is not None else 0))
    elif signal == "SELL":
        if rsi is not None and rsi < 30:
            return "REJECT", "Heuristic: RSI %.0f oversold — SELL rejected." % rsi, "heuristic"
        reasons.append("RSI %.0f not oversold" % (rsi if rsi is not None else 0))

    if not reasons:
        reasons.append("no conflicting indicators")
    return "CONFIRM", "Heuristic: " + "; ".join(reasons) + ".", "heuristic"


def ai_verdict(signal, ctx):
    """Get a free second opinion on a technical `signal`.

    ctx: dict with rsi, regime, position, price, symbol, strategy, support, resistance.
    Returns dict: {verdict, reason, provider, model, ts, signal}.
    """
    sym = ctx.get("symbol", "BTCUSDT")
    prompt = (
        "You are a disciplined crypto risk analyst. Given market context, decide "
        "whether to CONFIRM or REJECT the proposed trade signal. Reply in EXACTLY "
        "this format (one line):\n"
        "VERDICT: CONFIRM|REJECT\n"
        "REASON: <12 words max>\n\n"
        f"Symbol: {sym}\n"
        f"Proposed signal: {signal}\n"
        f"Current position: {ctx.get('position')}\n"
        f"RSI(14): {ctx.get('rsi')}\n"
        f"Market regime: {ctx.get('regime')}\n"
        f"Price: {ctx.get('price')}\n"
        f"Nearest support: {ctx.get('support')}\n"
        f"Nearest resistance: {ctx.get('resistance')}\n"
        f"Active strategy: {ctx.get('strategy')}\n"
    )

    # Try cloud providers (free tiers) in order of reliability.
    for getter, (provider, model) in (
        (_openrouter, ("openrouter", os.getenv("AI_MODEL", "auto"))),
        (_groq, ("groq", os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"))),
        (_huggingface, ("huggingface", "meta-llama/Llama-3.2-3B-Instruct")),
    ):
        try:
            raw = getter(prompt, model)
        except Exception:
            raw = None
        if raw:
            verdict, reason = _parse(raw, signal)
            return {
                "verdict": verdict, "reason": reason, "provider": provider,
                "model": model, "ts": datetime.now().isoformat(), "signal": signal,
            }

    # No key / all providers down → transparent local heuristic.
    verdict, reason, provider = _heuristic(signal, ctx)
    return {
        "verdict": verdict, "reason": reason, "provider": provider,
        "model": "local-rules", "ts": datetime.now().isoformat(), "signal": signal,
    }


def _parse(raw, signal):
    """Parse a free-LLM reply into (verdict, reason). Robust to messy output."""
    raw = (raw or "").strip()
    up = raw.upper()
    if "REJECT" in up and "CONFIRM" not in up.split("REJECT")[0][-12:]:
        verdict = "REJECT"
    elif "CONFIRM" in up:
        verdict = "CONFIRM"
    else:
        # No explicit keyword — default to confirming the technical signal,
        # but mark as CONFIRM only if the model didn't clearly object.
        verdict = "CONFIRM" if signal != "HOLD" else "CONFIRM"
    # Extract REASON line if present, else first sentence.
    reason = ""
    for line in raw.splitlines():
        if line.strip().upper().startswith("REASON:"):
            reason = line.split(":", 1)[1].strip()
            break
    if not reason:
        reason = raw.split("\n")[0][:120]
    return verdict, reason


if __name__ == "__main__":
    # Quick self-test (uses heuristic if no keys set).
    ctx = {"symbol": "BTCUSDT", "position": "flat", "rsi": 31, "regime": "bull",
           "price": 65000, "support": 62000, "resistance": 68000, "strategy": "reversion"}
    print(json.dumps(ai_verdict("BUY", ctx), indent=2))
