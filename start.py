#!/usr/bin/env python
"""
THUNDOC // 1-Command Universal Launcher
Launches backend engine + Cloudflare tunnel + auto-syncs Vercel frontend.
"""
import os
import sys
import subprocess

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_START = os.path.join(ROOT_DIR, "backend", "start.py")

if __name__ == "__main__":
    if not os.path.exists(BACKEND_START):
        print(f"[ERROR] Could not find backend start script at {BACKEND_START}")
        sys.exit(1)

    print("=" * 65)
    print("  [+] THUNDOC // ALGORITHMIC TRADING TERMINAL")
    print("  Initializing 1-Command Execution Pipeline...")
    print("=" * 65)

    try:
        proc = subprocess.run([sys.executable, BACKEND_START], cwd=ROOT_DIR)
        sys.exit(proc.returncode)
    except KeyboardInterrupt:
        print("\n[THUNDOC] Shutdown complete.")
        sys.exit(0)
