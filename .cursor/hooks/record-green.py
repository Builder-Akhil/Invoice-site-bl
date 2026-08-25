#!/usr/bin/env python3
"""Remember a green typecheck / production build for this workspace."""
import hashlib
import json
import os
import re
import sys
import time

def read_payload():
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}

def noop():
    sys.stdout.write("{}\n")
    sys.stdout.flush()

payload = read_payload()
cmd = str(payload.get("command") or payload.get("cmd") or "")
cwd = payload.get("cwd")
if not cwd:
    roots = payload.get("workspace_roots") or []
    cwd = roots[0] if roots else os.getcwd()
cwd = os.path.abspath(str(cwd))

code = payload.get("exitCode")
if code is None:
    code = payload.get("exit_code")
try:
    code = int(code)
except (TypeError, ValueError):
    code = 1

cmd_l = re.sub(r"\s+", " ", cmd.lower())
is_tsc = "tsc" in cmd_l and "--noemit" in cmd_l.replace(" ", "")
is_build = bool(re.search(r"(npm run build|\bnext build\b)", cmd_l))
if not (is_tsc or is_build):
    noop()
    sys.exit(0)

key = hashlib.sha1(cwd.encode()).hexdigest()[:12]
state_dir = "/tmp/cursor-ship-after-green"
os.makedirs(state_dir, exist_ok=True)
path = os.path.join(state_dir, f"{key}.json")
state = {}
if os.path.exists(path):
    try:
        with open(path) as f:
            state = json.load(f)
    except Exception:
        state = {}

now = time.time()
ok = code == 0
state["cwd"] = cwd
if is_tsc:
    state["tsc"] = ok
    state["tsc_at"] = now
if is_build:
    state["build"] = ok
    state["build_at"] = now
    if ok:
        state["tsc"] = True
        state["tsc_at"] = now

with open(path, "w") as f:
    json.dump(state, f)

noop()
