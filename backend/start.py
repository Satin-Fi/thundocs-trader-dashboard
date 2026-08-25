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

# Load local .env (gitignored) so VERCEL_TOKEN survives restarts without
# needing a global env var. Format: VERCEL_TOKEN=vcp_xxx
try:
    with open(os.path.join(HERE, ".env")) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip())
except FileNotFoundError:
    pass

FRONTEND_DIR = os.path.join(HERE, "..", "frontend")
REPO_ROOT = os.path.join(HERE, "..")  # where the real Vercel project (.vercel/) lives
CONFIG_JS = os.path.join(FRONTEND_DIR, "public", "config.js")
LOCK = os.path.join(HERE, ".startpy.lock")
PORT = os.getenv("PORT", "8000")
VERCEL_TOKEN = os.getenv("VERCEL_TOKEN", "")
CF_BIN = os.path.join(os.path.expanduser("~"), "cloudflared.exe")
if not os.path.exists(CF_BIN):
    CF_BIN = "cloudflared"  # fall back to PATH

URL_RE = re.compile(r"https://([a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com)")
# Real quick-tunnel URLs always contain a hyphen (e.g. zinc-find-having.trycloudflare.com).
# The API host "api.trycloudflare.com" has NO hyphen, so it will never match above.
API_HOST = "api.trycloudflare.com"

procs = []


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def copy_to_clipboard(text):
    try:
        p = subprocess.Popen("clip", stdin=subprocess.PIPE, shell=True)
        p.communicate(input=text.encode("utf-8"))
    except Exception:
        pass


def write_config(url):
    """Point the browser straight at the tunnel (CORS is enabled in app.py)."""
    if not url or API_HOST in url or "api.trycloudflare" in url:
        log("WARN: refusing to write bogus tunnel URL into config.js: " + str(url))
        return
    try:
        content = (
            "// Runtime config: browser calls the backend tunnel directly.\n"
            'window.__API_URL__ = "https://' + url + '";\n'
        )
        with open(CONFIG_JS, "w") as f:
            f.write(content)

        # Also write to dist/config.js if dist exists so local builds stay fresh
        dist_cfg = os.path.join(FRONTEND_DIR, "dist", "config.js")
        if os.path.exists(os.path.dirname(dist_cfg)):
            with open(dist_cfg, "w") as f:
                f.write(content)

        copy_to_clipboard(f"https://{url}")
        print("\n" + "=" * 65)
        print(f"  ⚡ LIVE TUNNEL CONNECTED: https://{url}")
        print(f"  📋 (Copied URL to your clipboard)")
        print(f"  🌐 VERCEL DASHBOARD: https://thundocs-trader-dashboard.vercel.app")
        print("=" * 65 + "\n", flush=True)
    except Exception as e:
        log(f"WARN: could not write config.js: {e}")


def clear_port(port):
    """Kill any process holding the given TCP port (Windows + fallback)."""
    try:
        import ctypes
        # Use netstat -ano to find PIDs holding the port
        r = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True, text=True, timeout=5
        )
        for line in r.stdout.splitlines():
            if f":{port} " in line and ("LISTENING" in line or "ESTABLISHED" in line):
                parts = line.split()
                pid = int(parts[-1])
                if pid and pid != os.getpid():
                    try:
                        subprocess.run(["taskkill", "/F", "/PID", str(pid)],
                                       capture_output=True, timeout=3)
                        log(f"Cleared PID {pid} from port {port}")
                    except Exception:
                        pass
    except Exception as e:
        log(f"WARN: could not clear port {port}: {e}")


def _start_backend_proc():
    """Spawn a single app.py process and return it."""
    return subprocess.Popen(
        [sys.executable, "app.py"],
        cwd=HERE,
        env={**os.environ, "PORT": PORT},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


_backend_lock = threading.Lock()


def start_backend():
    """Start app.py and launch a watchdog that restarts it if it crashes."""
    clear_port(int(PORT))
    time.sleep(0.5)
    p = _start_backend_proc()
    procs.append(p)
    threading.Thread(target=_pipe, args=(p, "backend"), daemon=True).start()

    def watchdog():
        proc = p
        while True:
            ret = proc.wait()
            log(f"WARN: backend exited (code {ret}) — restarting in 3s ...")
            time.sleep(3)
            with _backend_lock:
                clear_port(int(PORT))
                time.sleep(0.5)
                proc = _start_backend_proc()
                try:
                    procs.remove(p)
                except ValueError:
                    pass
                procs.append(proc)
            threading.Thread(target=_pipe, args=(proc, "backend"), daemon=True).start()

    threading.Thread(target=watchdog, daemon=True).start()
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
                    captured = True
                    # Auto-redeploy in a background thread so log streaming never pauses
                    threading.Thread(target=deploy_frontend, daemon=True).start()
        # Tunnel process died. Supervise it:
        log("WARN: tunnel process exited — restarting in 5s ...")
        try:
            p.wait(timeout=1)
        except Exception:
            pass
        time.sleep(5)
        try:
            procs.remove(p)
        except ValueError:
            pass
        start_tunnel()

    threading.Thread(target=watch, daemon=True).start()
    return p


def deploy_frontend():
    log("Rebuilding & syncing live Vercel production deployment in background...")
    try:
        b = subprocess.run(
            "npm run build",
            cwd=FRONTEND_DIR,
            shell=True,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if b.returncode != 0:
            log("WARN: npm run build failed: " + b.stderr.strip()[:300])
    except Exception as e:
        log(f"WARN: build error: {e}")
    cmd = "vercel deploy --prod --yes"
    if VERCEL_TOKEN:
        cmd += f" --token {VERCEL_TOKEN}"
    try:
        r = subprocess.run(
            cmd,
            cwd=REPO_ROOT,
            shell=True,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if r.returncode == 0:
            deployed_url = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "ok"
            log(f"✓ Vercel frontend live synced: {deployed_url}")
        else:
            log("WARN: vercel deploy returned: " + r.stderr.strip()[:300])
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
    try:
        os.remove(LOCK)
    except Exception:
        pass
    sys.exit(0)


if __name__ == "__main__":
    # Singleton guard via a lock file (reliable on Windows). Refuses to
    # start if the lock exists and points at a live PID, preventing stacked
    # orphan+manual instances that each spawn their own app.py + cloudflared
    # (which caused port conflicts and the dashboard flapping).
    try:
        if os.path.exists(LOCK):
            try:
                old_pid = int(open(LOCK).read().strip())
            except Exception:
                old_pid = None
            if old_pid and old_pid != os.getpid():
                try:
                    os.kill(old_pid, 0)  # raises if PID not alive (Windows)
                    log(f"REFUSING: another start.py already running (PID {old_pid}). "
                        f"Kill it or delete {LOCK} first.")
                    sys.exit(1)
                except OSError:
                    pass  # stale lock, ignore and overwrite
        with open(LOCK, "w") as _lf:
            _lf.write(str(os.getpid()))
    except Exception:
        pass  # best effort

    log(f"starting Paper Trader (backend :{PORT} + tunnel)")
    start_backend()
    time.sleep(2)
    start_tunnel()
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    log("running. Ctrl+C to stop. (auto-redeploy: on via Vercel CLI session" + (", token set" if VERCEL_TOKEN else "") + ")")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        shutdown()
