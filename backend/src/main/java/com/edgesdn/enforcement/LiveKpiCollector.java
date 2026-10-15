package com.edgesdn.enforcement;

import com.edgesdn.agent.AgentClient;
import com.edgesdn.agent.AgentModels.ProbePair;
import com.edgesdn.agent.AgentModels.ProbeResult;
import com.edgesdn.config.EdgeProperties;
import com.edgesdn.telemetry.TelemetryService;
import com.edgesdn.topology.TopologyIndex;
import com.edgesdn.twin.TrafficProfileBuilder;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Collects live-network KPIs: link utilisation from telemetry + latency/loss from ping probes. */
@Component
public class LiveKpiCollector {

    public record LiveKpi(Instant at, Double targetLinkUtil, Double maxLinkUtil, Double avgLatencyMs,
                          Double avgProbeLossPct, List<String> warnings) {
    }

    private final TelemetryService telemetry;
    private final AgentClient agent;
    private final TrafficProfileBuilder traffic;
    private final EdgeProperties props;

    public LiveKpiCollector(TelemetryService telemetry, AgentClient agent, TrafficProfileBuilder traffic,
                            EdgeProperties props) {
        this.telemetry = telemetry;
        this.agent = agent;
        this.traffic = traffic;
        this.props = props;
    }

    public LiveKpi collect(TopologyIndex t, String targetLinkId, Set<String> excludedClasses) {
        List<String> warnings = new ArrayList<>();
        Map<String, Double> utils = telemetry.latestLinkUtilization();
        if (telemetry.isStale()) {
            warnings.add("Telemetry is stale; utilisation values may be old");
        }
        Double target = utils.get(targetLinkId);
        Double max = utils.values().stream().max(Double::compare).orElse(null);

        List<ProbePair> probes = traffic.probes(t).stream().filter(p -> !excludedClasses.contains(p.tag())).toList();
        Double latency = null;
        Double loss = null;
        if (!probes.isEmpty()) {
            try {
                List<ProbeResult> res = agent.liveProbe(probes, props.getMonitoring().getProbeCount());
                latency = res.stream().filter(r -> r.avgRttMs() != null).mapToDouble(ProbeResult::avgRttMs)
                        .average().stream().boxed().findFirst().orElse(null);
                loss = res.stream().filter(r -> r.lossPct() != null).mapToDouble(ProbeResult::lossPct)
                        .average().stream().boxed().findFirst().orElse(null);
            } catch (Exception e) {
                warnings.add("Live probe failed: " + e.getMessage());
            }
        }
        return new LiveKpi(Instant.now(), target, max, latency, loss, warnings);
    }
}
