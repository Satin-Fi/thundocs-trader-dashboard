#!/usr/bin/env python
"""
One-command launcher for the Paper Trader bot + tunnel.

What it does (all automatic, no manual steps):
  1. Starts the backend API (app.py) on PORT (default 8000)
  2. Starts a Cloudflare tunnel to localhost:PORT
  3. Captures the live *.trycloudflare.com URL from cloudflared's output
  4. Writes that URL into ../frontend/public/config.js so the dashboard points at it
  5. If VERCEL_TOKEN is set, auto-redeploys the frontend (vercel deploy --prod)

If VERCEL_TOKEN is missing it still writes config.js and prints the one
command you need to run once:  vercel deploy --prod  (in the frontend dir).

Usage:
  python start.py                 # default PORT=8000
  PORT=8000 VERCEL_TOKEN=xxx python start.py
"""
import os
import re
import sys
import time
import json
import signal
import subprocess
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(HERE, "..", "frontend")
CONFIG_JS = os.path.join(FRONTEND_DIR, "public", "config.js")
VERCEL_JSON = os.path.join(FRONTEND_DIR, "vercel.json")
PORT = os.getenv("PORT", "8000")
VERCEL_TOKEN = os.getenv("VERCEL_TOKEN", "")
CF_BIN = os.path.join(os.path.expanduser("~"), "cloudflared.exe")
if not os.path.exists(CF_BIN):
    CF_BIN = "cloudflared"  # fall back to PATH

URL_RE = re.compile(r"https://([a-z0-9-]+\.trycloudflare\.com)")

procs = []


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def write_config(url):
    try:
        content = (
            "// Runtime config: the dashboard now talks to its OWN origin (vercel.app) and\n"
            "// Vercel proxies /api/* to the backend tunnel (see vercel.json). This keeps the\n"
            "// browser off the flapping Cloudflare quick-tunnel edge entirely.\n"
            'window.__API_URL__ = "";\n'
        )
        with open(CONFIG_JS, "w") as f:
            f.write(content)
        log(f"config.js updated -> same-origin proxy")
    except Exception as e:
        log(f"WARN: could not write config.js: {e}")


def write_vercel_json(url):
    """Keep the Vercel proxy rewrite pointed at the live tunnel URL."""
    try:
        cfg = {"rewrites": [{"source": "/api/:path*",
                             "destination": f"https://{url}/api/:path*"}]}
        with open(VERCEL_JSON, "w") as f:
            json.dump(cfg, f, indent=2)
        log(f"vercel.json proxy -> {url}")
    except Exception as e:
        log(f"WARN: could not write vercel.json: {e}")


def start_backend():
    p = subprocess.Popen(
        [sys.executable, "app.py"],
        cwd=HERE,
        env={**os.environ, "PORT": PORT},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    procs.append(p)
    threading.Thread(target=_pipe, args=(p, "backend"), daemon=True).start()
    return p


def start_tunnel():
    p = subprocess.Popen(
        [CF_BIN, "tunnel", "--url", f"http://localhost:{PORT}"],
        cwd=os.path.dirname(HERE),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    procs.append(p)

    def watch():
        captured = False
        for line in p.stdout:
            sys.stdout.write("[cf] " + line)
            if not captured:
                m = URL_RE.search(line)
                if m:
                    url = m.group(1)
                    write_config(url)
                    write_vercel_json(url)
                    captured = True
                    if VERCEL_TOKEN:
                        deploy_frontend()
        if not captured:
            log("WARN: tunnel URL not captured")

    threading.Thread(target=watch, daemon=True).start()
    return p


def deploy_frontend():
    log("auto-redeploying frontend to Vercel ...")
    try:
        r = subprocess.run(
            ["vercel", "deploy", "--prod", "--yes", "--token", VERCEL_TOKEN],
            cwd=FRONTEND_DIR,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if r.returncode == 0:
            log("frontend redeployed: " + (r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "ok"))
        else:
            log("WARN: vercel deploy failed: " + r.stderr.strip()[:300])
    except Exception as e:
        log(f"WARN: deploy error: {e}")


def _pipe(p, name):
    for line in p.stdout:
        sys.stdout.write(f"[{name}] {line}")


def shutdown(*a):
    log("shutting down ...")
    for p in procs:
        try:
            p.terminate()
        except Exception:
            pass
    sys.exit(0)


if __name__ == "__main__":
    log(f"starting Paper Trader (backend :{PORT} + tunnel)")
    if not os.path.exists(CF_BIN):
        log("WARN: cloudflared not found at " + CF_BIN + " — tunnel will not start")
    start_backend()
    time.sleep(3)
    start_tunnel()
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    log("running. Ctrl+C to stop. (VERCEL_TOKEN set: " + ("yes" if VERCEL_TOKEN else "no") + ")")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        shutdown()
