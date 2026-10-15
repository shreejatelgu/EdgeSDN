package com.edgesdn.twin;

import com.edgesdn.agent.AgentClient;
import com.edgesdn.agent.AgentModels.ProbePair;
import com.edgesdn.agent.AgentModels.TrafficFlow;
import com.edgesdn.agent.AgentModels.TwinRequest;
import com.edgesdn.agent.AgentModels.TwinResult;
import com.edgesdn.config.EdgeProperties;
import com.edgesdn.routing.FlowSpec;
import com.edgesdn.routing.MeterSpec;
import com.edgesdn.routing.RoutingService;
import com.edgesdn.topology.TopologyIndex;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Digital-twin gate. The twin receives the complete rule set the live network would have
 * (baseline + currently active actions + the candidate) and replays the predicted traffic.
 */
@Service
public class TwinService {

    private final AgentClient agent;
    private final RoutingService routing;
    private final EdgeProperties props;

    public TwinService(AgentClient agent, RoutingService routing, EdgeProperties props) {
        this.agent = agent;
        this.routing = routing;
        this.props = props;
    }

    public TwinResult simulate(TopologyIndex t, List<FlowSpec> activeFlows, List<MeterSpec> activeMeters,
                               List<FlowSpec> candidateFlows, List<MeterSpec> candidateMeters,
                               List<TrafficFlow> traffic, List<ProbePair> probes) {
        List<FlowSpec> flows = new ArrayList<>(routing.baselineFlowsFlat(t));
        flows.addAll(activeFlows);
        flows.addAll(candidateFlows);
        List<MeterSpec> meters = new ArrayList<>(activeMeters);
        meters.addAll(candidateMeters);
        return agent.simulate(new TwinRequest(flows, meters, traffic, probes, props.getTwin().getDurationSec()));
    }
}
