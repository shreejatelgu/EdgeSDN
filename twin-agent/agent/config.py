"""Runtime configuration from environment variables (see twin-agent/agent.env.example)."""
import os


def _bool(name: str, default: str) -> bool:
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


# Shared secret; must equal edge.agent.token in the Spring Boot application.yml.
AGENT_TOKEN = os.environ.get("EDGE_AGENT_TOKEN", "change-me-agent-token")

# OpenDaylight OpenFlow listener (usually on the same VM).
CONTROLLER_IP = os.environ.get("EDGE_CONTROLLER_IP", "127.0.0.1")
CONTROLLER_PORT = int(os.environ.get("EDGE_CONTROLLER_PORT", "6653"))

# "kernel" (default) or "user". Use "user" if `ovs-ofctl add-meter` fails on your kernel.
OVS_DATAPATH = os.environ.get("EDGE_OVS_DATAPATH", "kernel")

START_LIVE = _bool("EDGE_START_LIVE", "1")
START_TWIN = _bool("EDGE_START_TWIN", "1")
CLEAN_ON_START = _bool("EDGE_CLEAN_ON_START", "1")

IPERF = os.environ.get("EDGE_IPERF", "iperf")          # iperf2 (installed with Mininet)
MAX_QUEUE = int(os.environ.get("EDGE_MAX_QUEUE", "100"))  # packets per TCLink queue

TWIN_PORT_BASE = 6000   # iperf ports used inside the twin
LIVE_PORT_BASE = 7000   # iperf ports used for live demo traffic
MAX_FLOWS = 200
