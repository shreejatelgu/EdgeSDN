"""Emulated campus topology definition (single source of truth for names, ports and addresses).

    core:          c1 ===== c2                     (50 Mbps)
                  / | \\ \\  / / | \\
    distribution: d1  d2  d3  d4                   (each dual-homed to c1 and c2, 30 Mbps)
                 /  \\  / \\   |    |
    access:     a1  a2 a3 a4  a5   a6              (20 Mbps uplinks; a6 = server farm, 50 Mbps)
               EXAM LAB HOSTEL ADMIN LIBRARY SERVERS

Traffic classes are downloads from the server farm (a6) to each client group. Baseline BFS routing
sends every class through c1, so link c1-d4 becomes the bottleneck under load and c2 offers the
alternate path used by REROUTE candidates.
"""
from collections import defaultdict

SWITCHES = [
    ("c1", "CORE", 1), ("c2", "CORE", 2),
    ("d1", "DISTRIBUTION", 11), ("d2", "DISTRIBUTION", 12), ("d3", "DISTRIBUTION", 13), ("d4", "DISTRIBUTION", 14),
    ("a1", "ACCESS", 21), ("a2", "ACCESS", 22), ("a3", "ACCESS", 23), ("a4", "ACCESS", 24),
    ("a5", "ACCESS", 25), ("a6", "ACCESS", 26),
]

# (a, b, capacity Mbps) - order matters: it fixes the port numbers.
LINKS = [
    ("c1", "c2", 50),
    ("c1", "d1", 30), ("c2", "d1", 30),
    ("c1", "d2", 30), ("c2", "d2", 30),
    ("c1", "d3", 30), ("c2", "d3", 30),
    ("c1", "d4", 30), ("c2", "d4", 30),
    ("d1", "a1", 20), ("d1", "a2", 20),
    ("d2", "a3", 20), ("d2", "a4", 20),
    ("d3", "a5", 20),
    ("d4", "a6", 50),
]

# gid is used for the subnet 10.0.<gid>.0/24; users = real users represented (human-impact text only).
GROUPS = [
    dict(name="EXAM_HALL", label="Examination Hall", gid=1, switch="a1", hosts=4, priority="HIGH", users=300, server=False),
    dict(name="LAB", label="Computer Labs", gid=2, switch="a2", hosts=3, priority="MEDIUM", users=180, server=False),
    dict(name="HOSTEL", label="Hostel Wi-Fi", gid=3, switch="a3", hosts=3, priority="LOW", users=600, server=False),
    dict(name="ADMIN", label="Administration", gid=4, switch="a4", hosts=2, priority="HIGH", users=60, server=False),
    dict(name="LIBRARY", label="Library", gid=5, switch="a5", hosts=2, priority="MEDIUM", users=120, server=False),
    dict(name="SERVERS", label="Server Farm", gid=10, switch="a6", hosts=2, priority="HIGH", users=0, server=True),
]

CLIENT_HOST_BW = 20
SERVER_HOST_BW = 50


def link_id(a: str, b: str) -> str:
    return "-".join(sorted([a, b]))


def compute_spec() -> dict:
    """Deterministic topology spec: ports are assigned in LINKS order, then host ports per group."""
    ports = defaultdict(int)
    links = []
    for a, b, bw in LINKS:
        ports[a] += 1
        pa = ports[a]
        ports[b] += 1
        pb = ports[b]
        links.append(dict(id=link_id(a, b), a=a, aPort=pa, b=b, bPort=pb, capacityMbps=float(bw)))

    hosts, groups = [], []
    for g in GROUPS:
        names = []
        for i in range(1, g["hosts"] + 1):
            ports[g["switch"]] += 1
            name = f"h{g['gid']}n{i}"
            hosts.append(dict(
                name=name,
                ip=f"10.0.{g['gid']}.{i}",
                mac="00:00:00:00:%02x:%02x" % (g["gid"], i),
                group=g["name"],
                switchName=g["switch"],
                port=ports[g["switch"]],
                bw=float(SERVER_HOST_BW if g["server"] else CLIENT_HOST_BW),
            ))
            names.append(name)
        groups.append(dict(
            name=g["name"], label=g["label"], subnet=f"10.0.{g['gid']}.0/24", accessSwitch=g["switch"],
            priority=g["priority"], server=g["server"], hosts=names, users=g["users"],
        ))

    switches = [dict(name=n, dpid=d, role=r) for n, r, d in SWITCHES]
    return dict(switches=switches, hosts=hosts, links=links, groups=groups)


def switch_ports(spec: dict) -> dict:
    """switch name -> sorted list of used port numbers."""
    used = defaultdict(set)
    for l in spec["links"]:
        used[l["a"]].add(l["aPort"])
        used[l["b"]].add(l["bPort"])
    for h in spec["hosts"]:
        used[h["switchName"]].add(h["port"])
    return {k: sorted(v) for k, v in used.items()}
