package com.edgesdn.recommendation;

import com.edgesdn.config.EdgeProperties;
import com.edgesdn.policy.PolicyConfig;
import com.edgesdn.routing.FlowSpec;
import com.edgesdn.routing.MeterSpec;
import com.edgesdn.routing.RoutingService;
import com.edgesdn.topology.TopologyIndex;
import com.edgesdn.topology.TopologyModels.LinkInfo;
import com.edgesdn.topology.TopologyModels.TrafficClass;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Generates candidate remediations for a congested link:
 * <ul>
 *   <li>REROUTE each class crossing the link onto the shortest path that avoids the link (if one exists);</li>
 *   <li>RATE_LIMIT each non-HIGH-priority class crossing the link to policy.rateLimitFraction of its demand.</li>
 * </ul>
 * Classes that already have an active action are skipped (one action per class at a time).
 * Reroutes and rate limits are interleaved, largest demand first, up to policy.maxCandidates.
 */
@Component
public class CandidateGenerator {

    private final RoutingService routing;
    private final EdgeProperties props;

    public CandidateGenerator(RoutingService routing, EdgeProperties props) {
        this.routing = routing;
        this.props = props;
    }

    private record Draft(ActionType type, TrafficClass cls, List<String> path, List<String> baseline,
                         double demandMbps, Long rateKbps) {
    }

    public List<CandidateAction> generate(long recId, TopologyIndex t, LinkInfo target,
                                          Map<String, List<String>> classPaths, Set<String> classesWithActiveAction,
                                          Map<String, Double> classDemand, PolicyConfig policy) {
        List<Draft> reroutes = new ArrayList<>();
        List<Draft> limits = new ArrayList<>();
        for (TrafficClass c : t.trafficClasses()) {
            if (classesWithActiveAction.contains(c.id())) {
                continue;
            }
            List<String> current = classPaths.getOrDefault(c.id(), t.baselinePath(c));
            if (current.isEmpty() || !t.pathUsesLink(current, target.id())) {
                continue;
            }
            double demand = classDemand.getOrDefault(c.id(), 0.0);
            List<String> alt = t.path(c.source().accessSwitch(), c.destination().accessSwitch(), Set.of(target.id()));
            if (!alt.isEmpty()) {
                reroutes.add(new Draft(ActionType.REROUTE, c, alt, current, demand, null));
            }
            if (!"HIGH".equalsIgnoreCase(c.destination().priority()) && demand > 0) {
                long kbps = Math.max(500L, Math.round(demand * policy.getRateLimitFraction() * 1000));
                limits.add(new Draft(ActionType.RATE_LIMIT, c, current, current, demand, kbps));
            }
        }
        Comparator<Draft> byDemand = Comparator.comparingDouble(Draft::demandMbps).reversed()
                .thenComparing(d -> d.cls().id());
        reroutes.sort(byDemand);
        limits.sort(byDemand);

        List<Draft> merged = new ArrayList<>();
        for (int i = 0; i < Math.max(reroutes.size(), limits.size()); i++) {
            if (i < reroutes.size()) {
                merged.add(reroutes.get(i));
            }
            if (i < limits.size()) {
                merged.add(limits.get(i));
            }
        }
        int max = Math.max(1, Math.min(5, policy.getMaxCandidates()));
        List<CandidateAction> out = new ArrayList<>();
        for (int i = 0; i < Math.min(max, merged.size()); i++) {
            out.add(build(recId, i + 1, t, merged.get(i)));
        }
        return out;
    }

    private CandidateAction build(long recId, int idx, TopologyIndex t, Draft d) {
        String tag = "r" + recId + "c" + idx;
        TrafficClass c = d.cls();
        if (d.type() == ActionType.REROUTE) {
            List<FlowSpec> flows = routing.rerouteFlows(t, c, d.path(), tag);
            String desc = String.format("Reroute %s -> %s traffic via %s", c.source().label(), c.destination().label(),
                    String.join(" > ", d.path()));
            return new CandidateAction(ActionType.REROUTE, c, tag, desc, d.path(), d.baseline(), null, flows, List.of());
        }
        long meterId = (recId % 1000) * 10 + idx; // unique per candidate, small enough for any OVS datapath
        List<FlowSpec> flows = routing.rateLimitFlows(c, meterId, tag);
        MeterSpec meter = routing.meter(c, meterId, d.rateKbps(), props.getNetwork().getMeterBurstKb());
        String desc = String.format("Rate-limit %s -> %s traffic to %.1f Mbps (%.0f%% of predicted %.1f Mbps) at %s",
                c.source().label(), c.destination().label(), d.rateKbps() / 1000.0,
                d.demandMbps() > 0 ? d.rateKbps() / 10.0 / d.demandMbps() : 0, d.demandMbps(), c.source().accessSwitch());
        return new CandidateAction(ActionType.RATE_LIMIT, c, tag, desc, d.path(), d.baseline(), d.rateKbps(),
                flows, List.of(meter));
    }
}
