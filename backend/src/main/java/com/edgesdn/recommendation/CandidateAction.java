package com.edgesdn.recommendation;

import com.edgesdn.routing.FlowSpec;
import com.edgesdn.routing.MeterSpec;
import com.edgesdn.topology.TopologyModels.TrafficClass;

import java.util.List;

/**
 * In-memory candidate before simulation. path/baselinePath are switch sequences from the server access
 * switch to the class's access switch; rateKbps is set for RATE_LIMIT only.
 */
public record CandidateAction(ActionType type, TrafficClass trafficClass, String tag, String description,
                              List<String> path, List<String> baselinePath, Long rateKbps,
                              List<FlowSpec> flows, List<MeterSpec> meters) {
}
