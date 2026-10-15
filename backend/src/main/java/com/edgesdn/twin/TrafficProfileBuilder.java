package com.edgesdn.twin;

import com.edgesdn.agent.AgentModels.ProbePair;
import com.edgesdn.agent.AgentModels.TrafficFlow;
import com.edgesdn.common.MathUtil;
import com.edgesdn.config.EdgeProperties;
import com.edgesdn.topology.TopologyIndex;
import com.edgesdn.topology.TopologyModels.HostNode;
import com.edgesdn.topology.TopologyModels.LinkInfo;
import com.edgesdn.topology.TopologyModels.TrafficClass;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Turns demand figures into concrete iperf streams and ping probes between emulated hosts. */
@Component
public class TrafficProfileBuilder {

    private final EdgeProperties props;

    public TrafficProfileBuilder(EdgeProperties props) {
        this.props = props;
    }

    /**
     * Predicted demand per traffic class (Mbps). Classes crossing the target link are scaled so their
     * sum equals the forecast load of that link (predictedUtil x capacity); other classes keep their
     * current measured demand. Every class gets at least min-class-demand-mbps so the twin carries traffic.
     */
    public Map<String, Double> predictedClassDemand(TopologyIndex t, Map<String, Double> currentGroupDemand,
                                                    LinkInfo target, double predictedUtil,
                                                    Map<String, List<String>> classPaths) {
        double min = props.getTwin().getMinClassDemandMbps();
        Map<String, Double> demand = new LinkedHashMap<>();
        List<String> onTarget = new ArrayList<>();
        for (TrafficClass c : t.trafficClasses()) {
            demand.put(c.id(), Math.max(min, currentGroupDemand.getOrDefault(c.id(), 0.0)));
            List<String> path = classPaths.getOrDefault(c.id(), t.baselinePath(c));
            if (t.pathUsesLink(path, target.id())) {
                onTarget.add(c.id());
            }
        }
        double predictedMbps = predictedUtil * target.capacityMbps();
        double currentOnTarget = onTarget.stream().mapToDouble(demand::get).sum();
        if (!onTarget.isEmpty() && currentOnTarget > 0) {
            double scale = predictedMbps / currentOnTarget;
            for (String id : onTarget) {
                demand.put(id, MathUtil.round(Math.max(min, demand.get(id) * scale), 2));
            }
        }
        return demand;
    }

    /** One UDP stream per destination host; sources are the server hosts in round-robin order. */
    public List<TrafficFlow> flows(TopologyIndex t, Map<String, Double> classDemandMbps) {
        List<HostNode> servers = t.hostsOf(t.serverGroup());
        List<TrafficFlow> flows = new ArrayList<>();
        if (servers.isEmpty()) {
            return flows;
        }
        double maxRate = props.getTwin().getMaxFlowRateMbps();
        int rr = 0;
        for (TrafficClass c : t.trafficClasses()) {
            Double d = classDemandMbps.get(c.id());
            List<HostNode> dsts = t.hostsOf(c.destination());
            if (d == null || d <= 0 || dsts.isEmpty()) {
                continue;
            }
            double per = MathUtil.round(Math.max(0.1, Math.min(maxRate, d / dsts.size())), 2);
            for (HostNode dst : dsts) {
                flows.add(new TrafficFlow(c.id(), servers.get(rr++ % servers.size()).name(), dst.name(), per));
            }
        }
        return flows;
    }

    /** One latency probe per class: first server host -> first host of the class. */
    public List<ProbePair> probes(TopologyIndex t) {
        List<HostNode> servers = t.hostsOf(t.serverGroup());
        List<ProbePair> probes = new ArrayList<>();
        if (servers.isEmpty()) {
            return probes;
        }
        for (TrafficClass c : t.trafficClasses()) {
            List<HostNode> dsts = t.hostsOf(c.destination());
            if (!dsts.isEmpty()) {
                probes.add(new ProbePair(c.id(), servers.get(0).name(), dsts.get(0).name()));
            }
        }
        return probes;
    }
}
