"""Traffic generation (iperf2 UDP) and measurement (ping, interface counters) inside Mininet hosts."""
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from typing import List, Optional

from . import config
from .models import ProbePair, TrafficFlow

log = logging.getLogger("edge.traffic")

# iperf2 UDP report, e.g. "... 9.54 MBytes  10.0 Mbits/sec   0.021 ms    0/ 6803 (0%)"
IPERF_RE = re.compile(r"([\d.]+)\s+([KMG]?)bits/sec\s+[\d.]+\s+ms\s+(-?\d+)\s*/\s*(\d+)\s+\(([\d.eE+-]+)%\)")
RTT_RE = re.compile(r"=\s*[\d.]+/([\d.]+)/[\d.]+/[\d.]+\s*ms")
LOSS_RE = re.compile(r"([\d.]+)% packet loss")
UNIT = {"": 1e-6, "K": 1e-3, "M": 1.0, "G": 1000.0}


def _text(x) -> str:
    if x is None:
        return ""
    return x.decode("utf-8", "replace") if isinstance(x, (bytes, bytearray)) else str(x)


def parse_iperf(text: str):
    """-> (delivered Mbps, loss %) from the last UDP report line, or (None, None)."""
    last = None
    for m in IPERF_RE.finditer(text or ""):
        last = m
    if last is None:
        return None, None
    mbps = float(last.group(1)) * UNIT.get(last.group(2), 1.0)
    loss = max(0.0, min(100.0, float(last.group(5))))
    return round(mbps, 3), round(loss, 2)


def parse_ping(text: str):
    """-> (avg rtt ms or None, loss %)."""
    rtt = RTT_RE.search(text or "")
    loss = LOSS_RE.search(text or "")
    return (round(float(rtt.group(1)), 3) if rtt else None,
            round(float(loss.group(1)), 2) if loss else 100.0)


def _terminate(procs) -> None:
    for p in procs:
        try:
            if p.poll() is None:
                p.terminate()
        except Exception:
            pass
    deadline = time.time() + 2
    for p in procs:
        try:
            p.wait(timeout=max(0.1, deadline - time.time()))
        except Exception:
            try:
                p.kill()
            except Exception:
                pass


def run_measurement(netw, flows: List[TrafficFlow], probes: List[ProbePair], duration: int, port_base: int) -> dict:
    """Runs all UDP streams concurrently for `duration` s, pings each probe pair under load and measures
    per-link utilisation from interface counters over the steady-state window."""
    if len(flows) > config.MAX_FLOWS:
        raise ValueError(f"too many flows ({len(flows)} > {config.MAX_FLOWS})")
    workdir = tempfile.mkdtemp(prefix="edge_twin_")
    servers, clients, pings, logs = [], [], [], []
    warnings: List[str] = []
    try:
        # 1. iperf servers (one port per stream so each stream gets its own report)
        for i, f in enumerate(flows):
            port = port_base + i
            fh = open(os.path.join(workdir, f"srv_{port}.log"), "w")
            logs.append(fh)
            servers.append(netw.host(f.dst).popen(
                ["stdbuf", "-oL", config.IPERF, "-u", "-s", "-p", str(port)],
                stdout=fh, stderr=subprocess.STDOUT))
        time.sleep(0.5)

        # 2. clients
        t_start = time.time()
        for i, f in enumerate(flows):
            port = port_base + i
            dst_ip = netw.host(f.dst).IP()
            clients.append(netw.host(f.src).popen(
                [config.IPERF, "-u", "-c", dst_ip, "-p", str(port), "-b", f"{f.rateMbps:.2f}M",
                 "-t", str(duration), "-l", "1400"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT))

        # 3. steady-state window: skip 1 s ramp-up, stop 1 s before the end
        time.sleep(1.0)
        c0, t0 = netw.port_counters(), time.time()
        ping_count = max(3, min(40, int((duration - 2) / 0.2)))
        for p in probes:
            pings.append((p, netw.host(p.src).popen(
                ["ping", "-c", str(ping_count), "-i", "0.2", "-W", "1", "-q", netw.host(p.dst).IP()],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)))
        time.sleep(max(1.0, t_start + duration - 1.0 - time.time()))
        c1, t1 = netw.port_counters(), time.time()

        # 4. collect
        client_out = []
        for c in clients:
            try:
                out, _ = c.communicate(timeout=duration + 10)
            except subprocess.TimeoutExpired:
                c.kill()
                out, _ = c.communicate()
            client_out.append(_text(out))
        probe_results = []
        for p, proc in pings:
            try:
                out, _ = proc.communicate(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
                out, _ = proc.communicate()
            rtt, loss = parse_ping(_text(out))
            probe_results.append(dict(tag=p.tag, src=p.src, dst=p.dst, avgRttMs=rtt, lossPct=loss))
        time.sleep(0.8)  # let servers print their final reports
    finally:
        _terminate(servers + clients + [pr for _, pr in pings])
        for fh in logs:
            try:
                fh.close()
            except Exception:
                pass

    flow_results = []
    for i, f in enumerate(flows):
        port = port_base + i
        try:
            with open(os.path.join(workdir, f"srv_{port}.log"), "r") as fh:
                srv = fh.read()
        except OSError:
            srv = ""
        delivered, loss = parse_iperf(srv)
        if delivered is None:
            delivered, loss = parse_iperf(client_out[i] if i < len(client_out) else "")
        if delivered is None:
            warnings.append(f"no iperf report for {f.src}->{f.dst} (port {port})")
        flow_results.append(dict(tag=f.tag, src=f.src, dst=f.dst, offeredMbps=f.rateMbps,
                                 deliveredMbps=delivered, lossPct=loss))
    shutil.rmtree(workdir, ignore_errors=True)

    dt = t1 - t0
    links = netw.link_utilization(c0, c1, dt)
    return dict(linkUtilization=links,
                maxLinkUtilization=max(links.values()) if links else 0.0,
                flows=flow_results, probes=probe_results, warnings=warnings, measuredSec=round(dt, 2))


def probe_pairs(netw, pairs: List[ProbePair], count: int) -> List[dict]:
    """Concurrent pings on a running network (used by the rollback monitor on the live network)."""
    procs = []
    try:
        for p in pairs:
            procs.append((p, netw.host(p.src).popen(
                ["ping", "-c", str(count), "-i", "0.2", "-W", "1", "-q", netw.host(p.dst).IP()],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)))
        results = []
        for p, proc in procs:
            try:
                out, _ = proc.communicate(timeout=count * 0.2 + 10)
            except subprocess.TimeoutExpired:
                proc.kill()
                out, _ = proc.communicate()
            rtt, loss = parse_ping(_text(out))
            results.append(dict(tag=p.tag, src=p.src, dst=p.dst, avgRttMs=rtt, lossPct=loss))
        return results
    finally:
        _terminate([pr for _, pr in procs])


class LiveTraffic:
    """Background UDP load on the live network for demonstrations."""

    def __init__(self, netw):
        self.netw = netw
        self.lock = threading.Lock()
        self.procs = []
        self.flows: List[TrafficFlow] = []
        self.started_at: Optional[float] = None
        self.duration = 0
        self._timer: Optional[threading.Timer] = None

    def start(self, flows: List[TrafficFlow], duration: int) -> dict:
        if len(flows) > config.MAX_FLOWS:
            raise ValueError("too many flows")
        self.stop()
        with self.lock:
            procs = []
            try:
                for i, f in enumerate(flows):
                    port = config.LIVE_PORT_BASE + i
                    procs.append(self.netw.host(f.dst).popen(
                        [config.IPERF, "-u", "-s", "-p", str(port)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
                time.sleep(0.3)
                for i, f in enumerate(flows):
                    port = config.LIVE_PORT_BASE + i
                    procs.append(self.netw.host(f.src).popen(
                        [config.IPERF, "-u", "-c", self.netw.host(f.dst).IP(), "-p", str(port),
                         "-b", f"{f.rateMbps:.2f}M", "-t", str(duration), "-l", "1400"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            except Exception:
                _terminate(procs)
                raise
            self.procs = procs
            self.flows = list(flows)
            self.started_at = time.time()
            self.duration = duration
            self._timer = threading.Timer(duration + 5, self.stop)
            self._timer.daemon = True
            self._timer.start()
        return self.status()

    def stop(self) -> dict:
        with self.lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
            _terminate(self.procs)
            self.procs = []
            self.flows = []
            self.started_at = None
        return self.status()

    def status(self) -> dict:
        running = self.started_at is not None
        return dict(running=running,
                    streams=len(self.flows),
                    offeredMbps=round(sum(f.rateMbps for f in self.flows), 2),
                    remainingSec=max(0, int(self.started_at + self.duration - time.time())) if running else 0)
