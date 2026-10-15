package com.edgesdn.routing;

import com.edgesdn.topology.TopologyIndex;
import com.edgesdn.topology.TopologyModels.HostNode;
import com.edgesdn.topology.TopologyModels.SwitchNode;
import com.edgesdn.topology.TopologyModels.TrafficClass;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Builds all OpenFlow rules EDGE-SDN uses. Pipeline (identical in live network and twin):
 * <pre>
 * table 0 (actions):  prio 200  reroute   ip, src=server subnet, dst=class subnet -> output:port
 *                     prio 150  rate-lim  ip, src=server subnet, dst=class subnet -> meter:N, goto:1
 *                     prio 1    default   *                                        -> goto:1
 * table 1 (baseline): prio 100  ip, dst=host/32 -> output along BFS shortest path
 * </pre>
 * Hosts use static ARP (set by the agent), so only IPv4 forwarding rules are needed and no flooding
 * occurs in the looped campus topology.
 */
@Component
public class RoutingService {

    public static final int TABLE_ACTIONS = 0;
    public static final int TABLE_BASELINE = 1;
    public static final int PRIO_DEFAULT = 1;
    public static final int PRIO_BASELINE = 100;
    public static final int PRIO_RATE_LIMIT = 150;
    public static final int PRIO_REROUTE = 200;
    public static final int ETH_IPV4 = 0x0800;

    public FlowSpec defaultGotoFlow(String sw) {
        return new FlowSpec("edge-goto-" + sw, sw, TABLE_ACTIONS, PRIO_DEFAULT, FlowMatch.any(), null, TABLE_BASELINE, null);
    }

    /** switch name -> baseline (table 1) flows. */
    public Map<String, List<FlowSpec>> baselineTables(TopologyIndex t) {
        Map<String, List<FlowSpec>> tables = new LinkedHashMap<>();
        for (SwitchNode s : t.switches()) {
            tables.put(s.name(), new ArrayList<>());
        }
        for (HostNode h : t.topology().hosts()) {
            Map<String, String> next = t.nextHopsTowards(h.switchName(), Set.of());
            for (SwitchNode s : t.switches()) {
                String sw = s.name();
                if (!next.containsKey(sw)) {
                    continue;
                }
                int port = sw.equals(h.switchName()) ? h.port() : t.portTowards(sw, next.get(sw));
                tables.get(sw).add(new FlowSpec("edge-base-" + sw + "-" + h.name(), sw, TABLE_BASELINE, PRIO_BASELINE,
                        new FlowMatch(ETH_IPV4, null, h.ip() + "/32", null), port, null, null));
            }
        }
        return tables;
    }

    /** Baseline + default goto flows for every switch, flattened (used for the digital twin). */
    public List<FlowSpec> baselineFlowsFlat(TopologyIndex t) {
        List<FlowSpec> all = new ArrayList<>();
        for (SwitchNode s : t.switches()) {
            all.add(defaultGotoFlow(s.name()));
        }
        baselineTables(t).values().forEach(all::addAll);
        return all;
    }

    /**
     * Reroute flows along {@code path} (server access switch ... destination access switch).
     * The last switch needs no rule: its baseline /32 rules deliver to the hosts.
     */
    public List<FlowSpec> rerouteFlows(TopologyIndex t, TrafficClass c, List<String> path, String tag) {
        List<FlowSpec> flows = new ArrayList<>();
        FlowMatch match = new FlowMatch(ETH_IPV4, c.source().subnet(), c.destination().subnet(), null);
        for (int i = 0; i + 1 < path.size(); i++) {
            String sw = path.get(i);
            flows.add(new FlowSpec("edge-" + tag + "-" + sw, sw, TABLE_ACTIONS, PRIO_REROUTE, match,
                    t.portTowards(sw, path.get(i + 1)), null, null));
        }
        return flows;
    }

    /** Rate-limit flow at the server access switch: meter the class, then continue with baseline forwarding. */
    public List<FlowSpec> rateLimitFlows(TrafficClass c, long meterId, String tag) {
        String sw = c.source().accessSwitch();
        FlowMatch match = new FlowMatch(ETH_IPV4, c.source().subnet(), c.destination().subnet(), null);
        return List.of(new FlowSpec("edge-" + tag + "-" + sw, sw, TABLE_ACTIONS, PRIO_RATE_LIMIT, match,
                null, TABLE_BASELINE, meterId));
    }

    public MeterSpec meter(TrafficClass c, long meterId, long rateKbps, long burstKb) {
        return new MeterSpec(c.source().accessSwitch(), meterId, rateKbps, burstKb);
    }
}
