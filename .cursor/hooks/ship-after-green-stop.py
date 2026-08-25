#!/usr/bin/env python3
"""If typecheck + build passed and git is dirty, make the agent commit and push."""
import hashlib
import json
import os
import subprocess
import sys
import time

SKIP_PREFIXES = (".env",)
SKIP_NAMES = {".ds_store", ".env"}

def read_payload():
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}

def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

def git_root(start):
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=start, text=True, stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        return None

payload = read_payload()
if payload.get("status") != "completed":
    out({})
    sys.exit(0)
if int(payload.get("loop_count") or 0) >= 1:
    out({})
    sys.exit(0)

roots = payload.get("workspace_roots") or []
start = os.path.abspath(str(roots[0] if roots else os.getcwd()))
root = git_root(start)
if not root:
    out({})
    sys.exit(0)

key = hashlib.sha1(root.encode()).hexdigest()[:12]
path = f"/tmp/cursor-ship-after-green/{key}.json"
if not os.path.exists(path):
    out({})
    sys.exit(0)
try:
    with open(path) as f:
        state = json.load(f)
except Exception:
    out({})
    sys.exit(0)

if not (state.get("tsc") and state.get("build")):
    out({})
    sys.exit(0)
newest = max(float(state.get("tsc_at") or 0), float(state.get("build_at") or 0))
if time.time() - newest > 2 * 3600:
    out({})
    sys.exit(0)

try:
    porcelain = subprocess.check_output(
        ["git", "status", "--porcelain"], cwd=root, text=True,
    )
except Exception:
    out({})
    sys.exit(0)

dirty = []
for line in porcelain.splitlines():
    rel = line[3:].strip().split(" -> ")[-1]
    base = os.path.basename(rel).lower()
    if base in SKIP_NAMES or rel.startswith(SKIP_PREFIXES) or "/.env" in rel:
        continue
    dirty.append(rel)

if not dirty:
    out({})
    sys.exit(0)

out({
    "followup_message": (
        "Typecheck and production build both passed, and uncommitted changes remain. "
        "Commit them now (HEREDOC message, skip .env/secrets) and push to origin. "
        "Do not ask. Do not skip."
    )
})
