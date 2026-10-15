package com.edgesdn.topology;

import java.util.List;

/**
 * Topology as reported by the twin-agent (GET /topology). The agent is the single source of
 * truth for switch names, DPIDs, port numbers, host addresses and host groups.
 */
public final class TopologyModels {

    private TopologyModels() {
    }

    /** role: CORE, DISTRIBUTION or ACCESS. */
    public record SwitchNode(String name, long dpid, String role) {
    }

    public record HostNode(String name, String ip, String mac, String group, String switchName, int port) {
    }

    public record LinkInfo(String id, String a, int aPort, String b, int bPort, double capacityMbps) {

        public boolean touches(String sw) {
            return a.equals(sw) || b.equals(sw);
        }

        public String other(String sw) {
            return a.equals(sw) ? b : a;
        }

        public int portOn(String sw) {
            if (a.equals(sw)) {
                return aPort;
            }
            if (b.equals(sw)) {
                return bPort;
            }
            throw new IllegalArgumentException("Link " + id + " does not touch switch " + sw);
        }
    }

    /**
     * A set of hosts behind one access switch sharing a /24 subnet.
     * priority: HIGH, MEDIUM or LOW. users: nominal number of real users the emulated hosts stand for
     * (used only for the human-impact statement).
     */
    public record HostGroup(String name, String label, String subnet, String accessSwitch, String priority,
                            boolean server, List<String> hosts, int users) {
    }

    public record Topology(List<SwitchNode> switches, List<HostNode> hosts, List<LinkInfo> links,
                           List<HostGroup> groups) {
    }

    /**
     * Traffic class = downloads from the server farm (source) to one client group (destination).
     * The class id is the destination group name, e.g. "EXAM_HALL".
     */
    public record TrafficClass(String id, HostGroup source, HostGroup destination) {
    }
}
