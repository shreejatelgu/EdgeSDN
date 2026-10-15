#!/usr/bin/env bash
# Starts the EDGE-SDN twin-agent. Usage:  sudo ./run_agent.sh
set -euo pipefail
cd "$(dirname "$0")"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo ./run_agent.sh" >&2
  exit 1
fi
if [[ -f agent.env ]]; then
  set -a; source agent.env; set +a
fi
if [[ ! -x .venv/bin/uvicorn ]]; then
  echo "Virtualenv missing. Create it first (see SETUP_GUIDE.md step 6)." >&2
  exit 1
fi
exec .venv/bin/uvicorn agent.main:app --host 0.0.0.0 --port 8000 --workers 1
