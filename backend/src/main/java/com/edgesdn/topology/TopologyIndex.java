package com.edgesdn.topology;

import com.edgesdn.topology.TopologyModels.HostGroup;
import com.edgesdn.topology.TopologyModels.HostNode;
import com.edgesdn.topology.TopologyModels.LinkInfo;
import com.edgesdn.topology.TopologyModels.SwitchNode;
import com.edgesdn.topology.TopologyModels.Topology;
import com.edgesdn.topology.TopologyModels.TrafficClass;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * Immutable, indexed view of the topology with deterministic path computation.
 * <p>
 * Paths are hop-count shortest paths computed by BFS rooted at the destination switch with
 * neighbours visited in name order, so the same inputs always produce the same path. Baseline
 * forwarding flows use exactly the same BFS, which keeps "the path a class currently uses" and
 * "the flows installed in the switches" consistent.
 */
public final class TopologyIndex {

    private final Topology topology;
    private final Map<String, SwitchNode> switches = new LinkedHashMap<>();
    private final Map<Long, SwitchNode> switchesByDpid = new HashMap<>();
    private final Map<String, HostNode> hosts = new LinkedHashMap<>();
    private final Map<String, LinkInfo> links = new LinkedHashMap<>();
    private final Map<String, List<LinkInfo>> adjacency = new HashMap<>();
    private final Map<String, HostGroup> groups = new LinkedHashMap<>();
    private final HostGroup serverGroup;
    private final List<TrafficClass> trafficClasses;

    public TopologyIndex(Topology t) {
        Objects.requireNonNull(t, "topology");
        if (t.switches() == null || t.links() == null || t.hosts() == null || t.groups() == null) {
            throw new IllegalArgumentException("Topology is incomplete (switches/links/hosts/groups missing)");
        }
        this.topology = t;
        for (SwitchNode s : t.switches()) {
            switches.put(s.name(), s);
            switchesByDpid.put(s.dpid(), s);
        }
        for (HostNode h : t.hosts()) {
            if (!switches.containsKey(h.switchName())) {
                throw new IllegalArgumentException("Host " + h.name() + " attached to unknown switch " + h.switchName());
            }
            hosts.put(h.name(), h);
        }
        for (LinkInfo l : t.links()) {
            if (!switches.containsKey(l.a()) || !switches.containsKey(l.b())) {
                throw new IllegalArgumentException("Link " + l.id() + " references an unknown switch");
            }
            links.put(l.id(), l);
            adjacency.computeIfAbsent(l.a(), k -> new ArrayList<>()).add(l);
            adjacency.computeIfAbsent(l.b(), k -> new ArrayList<>()).add(l);
        }
        adjacency.forEach((sw, list) -> list.sort(Comparator.comparing(l -> l.other(sw))));
        for (HostGroup g : t.groups()) {
            groups.put(g.name(), g);
        }
        this.serverGroup = t.groups().stream().filter(HostGroup::server).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Topology has no server group"));
        List<TrafficClass> classes = new ArrayList<>();
        for (HostGroup g : t.groups()) {
            if (!g.server()) {
                classes.add(new TrafficClass(g.name(), serverGroup, g));
            }
        }
        this.trafficClasses = List.copyOf(classes);
    }

    public Topology topology() {
        return topology;
    }

    public Collection<SwitchNode> switches() {
        return switches.values();
    }

    public Collection<LinkInfo> links() {
        return links.values();
    }

    public Collection<HostGroup> groups() {
        return groups.values();
    }

    public HostGroup serverGroup() {
        return serverGroup;
    }

    public List<TrafficClass> trafficClasses() {
        return trafficClasses;
    }

    public Optional<TrafficClass> trafficClass(String id) {
        return trafficClasses.stream().filter(c -> c.id().equals(id)).findFirst();
    }

    public SwitchNode switchNode(String name) {
        SwitchNode s = switches.get(name);
        if (s == null) {
            throw new IllegalArgumentException("Unknown switch " + name);
        }
        return s;
    }

    public Optional<SwitchNode> switchByDpid(long dpid) {
        return Optional.ofNullable(switchesByDpid.get(dpid));
    }

    public LinkInfo link(String id) {
        LinkInfo l = links.get(id);
        if (l == null) {
            throw new IllegalArgumentException("Unknown link " + id);
        }
        return l;
    }

    public boolean hasLink(String id) {
        return links.containsKey(id);
    }

    public Optional<HostNode> host(String name) {
        return Optional.ofNullable(hosts.get(name));
    }

    public HostGroup group(String name) {
        HostGroup g = groups.get(name);
        if (g == null) {
            throw new IllegalArgumentException("Unknown host group " + name);
        }
        return g;
    }

    public boolean hasGroup(String name) {
        return groups.containsKey(name);
    }

    public List<HostNode> hostsOf(HostGroup g) {
        return g.hosts().stream().map(hosts::get).filter(Objects::nonNull).toList();
    }

    public List<LinkInfo> linksOf(String sw) {
        return adjacency.getOrDefault(sw, List.of());
    }

    public boolean isCore(String sw) {
        SwitchNode s = switches.get(sw);
        return s != null && "CORE".equalsIgnoreCase(s.role());
    }

    /** OpenDaylight inventory node id, e.g. "openflow:21". */
    public String odlNodeId(String sw) {
        return "openflow:" + Long.toUnsignedString(switchNode(sw).dpid());
    }

    /**
     * For every switch reachable from {@code root}: the neighbour to forward to in order to reach root.
     * root maps to itself.
     */
    public Map<String, String> nextHopsTowards(String root, Set<String> excludedLinkIds) {
        Map<String, String> next = new HashMap<>();
        Deque<String> queue = new ArrayDeque<>();
        next.put(root, root);
        queue.add(root);
        while (!queue.isEmpty()) {
            String cur = queue.poll();
            for (LinkInfo l : adjacency.getOrDefault(cur, List.of())) {
                if (excludedLinkIds.contains(l.id())) {
                    continue;
                }
                String nb = l.other(cur);
                if (!next.containsKey(nb)) {
                    next.put(nb, cur);
                    queue.add(nb);
                }
            }
        }
        return next;
    }

    /** Switch sequence from -> to, or an empty list when unreachable. */
    public List<String> path(String from, String to, Set<String> excludedLinkIds) {
        if (from.equals(to)) {
            return List.of(from);
        }
        Map<String, String> next = nextHopsTowards(to, excludedLinkIds);
        if (!next.containsKey(from)) {
            return List.of();
        }
        List<String> p = new ArrayList<>();
        String cur = from;
        p.add(cur);
        int guard = 0;
        while (!cur.equals(to) && guard++ < switches.size() + 1) {
            cur = next.get(cur);
            p.add(cur);
        }
        return List.copyOf(p);
    }

    public List<String> baselinePath(TrafficClass c) {
        return path(c.source().accessSwitch(), c.destination().accessSwitch(), Set.of());
    }

    public List<LinkInfo> linksOnPath(List<String> path) {
        List<LinkInfo> out = new ArrayList<>();
        for (int i = 0; i + 1 < path.size(); i++) {
            out.add(linkBetween(path.get(i), path.get(i + 1)));
        }
        return out;
    }

    public boolean pathUsesLink(List<String> path, String linkId) {
        return linksOnPath(path).stream().anyMatch(l -> l.id().equals(linkId));
    }

    public LinkInfo linkBetween(String a, String b) {
        return adjacency.getOrDefault(a, List.of()).stream()
                .filter(l -> l.other(a).equals(b))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("No link between " + a + " and " + b));
    }

    public int portTowards(String sw, String neighbour) {
        return linkBetween(sw, neighbour).portOn(sw);
    }

    /** Sum of capacities of all links touching the switch (used to normalise group demand). */
    public double uplinkCapacity(String sw) {
        return linksOf(sw).stream().mapToDouble(LinkInfo::capacityMbps).sum();
    }
}
