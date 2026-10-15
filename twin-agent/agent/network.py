"""Builds and manages one Mininet network (used twice: the live network and the digital twin)."""
import logging
import threading
from collections import defaultdict
from typing import Dict, List, Optional

from mininet.link import TCLink
from mininet.net import Mininet
from mininet.node import OVSSwitch, RemoteController

from . import config, ovs
from .models import FlowSpec, MeterSpec
from .topology import switch_ports

log = logging.getLogger("edge.network")


class EmulatedNetwork:
    """
    sw_prefix / host_prefix keep live and twin node names apart in the root namespace:
      live:  switches c1, d1, a1 ...   hosts h1n1 ...   (connected to OpenDaylight)
      twin:  switches tc1, td1 ...     hosts x1n1 ...   (no controller, rules via ovs-ofctl)
    """

    def __init__(self, spec: dict, sw_prefix: str, host_prefix: str, dpid_offset: int,
                 controller_ip: Optional[str] = None, controller_port: int = 6653):
        self.spec = spec
        self.sw_prefix = sw_prefix
        self.host_prefix = host_prefix
        self.dpid_offset = dpid_offset
        self.controller_ip = controller_ip
        self.controller_port = controller_port
        self.net: Optional[Mininet] = None
        self.lock = threading.RLock()
        self.ports = switch_ports(spec)
        self.switch_names = {s["name"] for s in spec["switches"]}
        self.host_names = {h["name"] for h in spec["hosts"]}

    # ----------------------------------------------------------------- naming

    def sw(self, logical: str) -> str:
        return self.sw_prefix + logical

    def host_name(self, logical: str) -> str:
        # logical host names look like "h1n1"; the twin replaces the leading "h"
        return self.host_prefix + logical[1:]

    def host(self, logical: str):
        if logical not in self.host_names:
            raise ValueError(f"unknown host {logical}")
        return self.net.get(self.host_name(logical))

    # ----------------------------------------------------------------- lifecycle

    def start(self) -> None:
        with self.lock:
            net = Mininet(topo=None, build=False, controller=None, switch=OVSSwitch, link=TCLink,
                          autoSetMacs=False, autoStaticArp=False, waitConnected=False)
            if self.controller_ip:
                net.addController("odl", controller=RemoteController, ip=self.controller_ip,
                                  port=self.controller_port)
            for s in self.spec["switches"]:
                net.addSwitch(self.sw(s["name"]), dpid="%016x" % (s["dpid"] + self.dpid_offset),
                              protocols="OpenFlow13", failMode="secure", datapath=config.OVS_DATAPATH)
            for l in self.spec["links"]:
                net.addLink(self.sw(l["a"]), self.sw(l["b"]), port1=l["aPort"], port2=l["bPort"],
                            bw=l["capacityMbps"], max_queue_size=config.MAX_QUEUE)
            for h in self.spec["hosts"]:
                hn = self.host_name(h["name"])
                net.addHost(hn, ip=h["ip"] + "/8", mac=h["mac"])
                net.addLink(hn, self.sw(h["switchName"]), port1=0, port2=h["port"],
                            bw=h["bw"], max_queue_size=config.MAX_QUEUE)
            net.build()
            net.start()
            net.staticArp()  # no ARP broadcast -> no flooding needed in the looped topology
            self.net = net
            log.info("network %s started (%d switches, %d hosts)", self.sw_prefix or "live",
                     len(self.spec["switches"]), len(self.spec["hosts"]))

    def stop(self) -> None:
        with self.lock:
            if self.net is not None:
                try:
                    self.net.stop()
                finally:
                    self.net = None

    @property
    def running(self) -> bool:
        return self.net is not None

    # ----------------------------------------------------------------- rules (twin only)

    def load_rules(self, flows: List[FlowSpec], meters: List[MeterSpec]) -> None:
        by_bridge: Dict[str, List[str]] = defaultdict(list)
        for f in flows:
            if f.switchName not in self.switch_names:
                raise ValueError(f"flow {f.id}: unknown switch {f.switchName}")
            by_bridge[self.sw(f.switchName)].append(ovs.flow_to_ofctl(f))
        for m in meters:
            if m.switchName not in self.switch_names:
                raise ValueError(f"meter {m.meterId}: unknown switch {m.switchName}")
        for name in self.switch_names:
            ovs.clear_bridge(self.sw(name))
        for m in meters:
            ovs.add_meter(self.sw(m.switchName), m)
        for bridge, lines in by_bridge.items():
            ovs.add_flows(bridge, lines)

    # ----------------------------------------------------------------- counters

    def port_counters(self) -> Dict[str, Dict[str, dict]]:
        """switch -> port -> {rxBytes, txBytes} read from the switch-side veth interfaces."""
        out: Dict[str, Dict[str, dict]] = {}
        for name in self.switch_names:
            ports = {}
            for p in self.ports.get(name, []):
                intf = f"{self.sw(name)}-eth{p}"
                rx = ovs.read_counter(intf, "rx_bytes")
                tx = ovs.read_counter(intf, "tx_bytes")
                if rx >= 0 and tx >= 0:
                    ports[str(p)] = {"rxBytes": rx, "txBytes": tx}
            out[name] = ports
        return out

    def link_utilization(self, before: dict, after: dict, dt: float) -> Dict[str, float]:
        util = {}
        for l in self.spec["links"]:
            def tx(snap, sw, port):
                return snap.get(sw, {}).get(str(port), {}).get("txBytes")
            deltas = []
            for sw, port in ((l["a"], l["aPort"]), (l["b"], l["bPort"])):
                t0, t1 = tx(before, sw, port), tx(after, sw, port)
                if t0 is not None and t1 is not None and t1 >= t0:
                    deltas.append(t1 - t0)
            if not deltas or dt <= 0:
                continue
            mbps = max(deltas) * 8.0 / dt / 1e6
            util[l["id"]] = round(mbps / l["capacityMbps"], 4) if l["capacityMbps"] > 0 else 0.0
        return util
