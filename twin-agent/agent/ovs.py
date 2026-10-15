"""Open vSwitch helpers for the digital twin (the twin has no controller; rules go in via ovs-ofctl)."""
import subprocess
from typing import Iterable, List

from .models import FlowSpec, MeterSpec

OFCTL = ["ovs-ofctl", "-O", "OpenFlow13"]


def run(args: List[str], input_text: str = None, check: bool = True, timeout: int = 30) -> str:
    p = subprocess.run(args, input=input_text, text=True, capture_output=True, timeout=timeout)
    if check and p.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} failed: {p.stderr.strip() or p.stdout.strip()}")
    return p.stdout


def flow_to_ofctl(f: FlowSpec) -> str:
    """FlowSpec -> ovs-ofctl flow syntax, mirroring what OpenDaylight installs on the live switches."""
    parts = [f"table={f.table}", f"priority={f.priority}"]
    m = f.match
    if m.ethType == 0x0800 or m.ipv4Src or m.ipv4Dst:
        parts.append("ip")
    elif m.ethType is not None:
        parts.append(f"dl_type=0x{m.ethType:04x}")
    if m.inPort is not None:
        parts.append(f"in_port={m.inPort}")
    if m.ipv4Src:
        parts.append(f"nw_src={m.ipv4Src}")
    if m.ipv4Dst:
        parts.append(f"nw_dst={m.ipv4Dst}")
    actions = []
    if f.meterId is not None:
        actions.append(f"meter:{f.meterId}")
    if f.outputPort is not None:
        actions.append(f"output:{f.outputPort}")
    if f.gotoTable is not None:
        actions.append(f"goto_table:{f.gotoTable}")
    if not actions:
        actions.append("drop")
    return ",".join(parts) + ",actions=" + ",".join(actions)


def clear_bridge(bridge: str) -> None:
    run(OFCTL + ["del-flows", bridge])
    run(OFCTL + ["del-meters", bridge], check=False)


def add_flows(bridge: str, lines: Iterable[str]) -> None:
    body = "\n".join(lines)
    if body:
        run(OFCTL + ["add-flows", bridge, "-"], input_text=body + "\n")


def add_meter(bridge: str, m: MeterSpec) -> None:
    burst = max(1, m.burstKb)
    spec = f"meter={m.meterId},kbps,burst,band=type=drop,rate={m.rateKbps},burst_size={burst}"
    run(OFCTL + ["add-meter", bridge, spec])


def read_counter(intf: str, name: str) -> int:
    try:
        with open(f"/sys/class/net/{intf}/statistics/{name}", "r") as fh:
            return int(fh.read().strip())
    except (OSError, ValueError):
        return -1
