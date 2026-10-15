package com.edgesdn.prediction;

import com.edgesdn.agent.AgentClient;
import com.edgesdn.agent.AgentModels.LiveTrafficRequest;
import com.edgesdn.agent.AgentModels.TrafficFlow;
import com.edgesdn.audit.AuditService;
import com.edgesdn.audit.AuditType;
import com.edgesdn.common.Exceptions.BadRequestException;
import com.edgesdn.common.Exceptions.NotFoundException;
import com.edgesdn.prediction.PredictionModels.Counterfactual;
import com.edgesdn.prediction.PredictionModels.Factor;
import com.edgesdn.prediction.PredictionModels.LinkForecast;
import com.edgesdn.topology.TopologyIndex;
import com.edgesdn.topology.TopologyService;
import com.edgesdn.twin.TrafficProfileBuilder;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import static com.edgesdn.common.MathUtil.clamp;

/**
 * Demo support, clearly labelled everywhere it is used:
 * (1) forecast overrides so a congestion episode can be reproduced on demand, and
 * (2) real UDP load on the live Mininet network through the twin-agent.
 * Overrides are marked in the forecast source ("+SCENARIO"), in the factual explanation and in the audit log.
 */
@Service
public class ScenarioService {

    public record ScenarioOverride(String id, String linkId, Integer horizonMinutes, double predictedUtilization,
                                   double confidence, Instant expiresAt, String note, String createdBy) {
    }

    public record ScenarioRequest(@NotBlank String linkId,
                                  Integer horizonMinutes,
                                  @DecimalMin("0.0") @DecimalMax("1.5") double predictedUtilization,
                                  @DecimalMin("0.0") @DecimalMax("1.0") Double confidence,
                                  @Min(1) @Max(240) Integer durationMinutes,
                                  @Size(max = 300) String note) {
    }

    /** demands: traffic class id -> Mbps offered on the live network. */
    public record LiveTrafficCommand(@NotEmpty Map<String, Double> demands, @Min(10) @Max(3600) Integer durationSec) {
    }

    private final List<ScenarioOverride> overrides = new CopyOnWriteArrayList<>();
    private final TopologyService topology;
    private final AgentClient agent;
    private final TrafficProfileBuilder traffic;
    private final AuditService audit;

    public ScenarioService(TopologyService topology, AgentClient agent, TrafficProfileBuilder traffic,
                           AuditService audit) {
        this.topology = topology;
        this.agent = agent;
        this.traffic = traffic;
        this.audit = audit;
    }

    public List<ScenarioOverride> list() {
        purgeExpired();
        return List.copyOf(overrides);
    }

    public ScenarioOverride add(ScenarioRequest r, String actor) {
        TopologyIndex t = topology.require();
        if (!t.hasLink(r.linkId())) {
            throw new BadRequestException("Unknown link " + r.linkId());
        }
        int minutes = r.durationMinutes() == null ? 30 : r.durationMinutes();
        ScenarioOverride o = new ScenarioOverride(UUID.randomUUID().toString(), r.linkId(), r.horizonMinutes(),
                r.predictedUtilization(), r.confidence() == null ? 0.85 : r.confidence(),
                Instant.now().plus(Duration.ofMinutes(minutes)),
                r.note() == null || r.note().isBlank() ? "demo scenario" : r.note(), actor);
        overrides.removeIf(x -> x.linkId().equals(o.linkId()) && java.util.Objects.equals(x.horizonMinutes(), o.horizonMinutes()));
        overrides.add(o);
        audit.record(AuditType.SCENARIO_INJECTED, actor, null, null,
                String.format("Demo forecast override on %s: %.0f%% for %d min", o.linkId(), o.predictedUtilization() * 100, minutes), o);
        return o;
    }

    public void remove(String id, String actor) {
        if (!overrides.removeIf(o -> o.id().equals(id))) {
            throw new NotFoundException("Scenario " + id + " not found");
        }
        audit.record(AuditType.SCENARIO_CLEARED, actor, null, null, "Demo scenario " + id + " removed", null);
    }

    public void clear(String actor) {
        overrides.clear();
        audit.record(AuditType.SCENARIO_CLEARED, actor, null, null, "All demo scenarios removed", null);
    }

    /** Applies active overrides to a forecast list (returns a new list). */
    public List<LinkForecast> apply(List<LinkForecast> forecasts, double threshold) {
        purgeExpired();
        if (overrides.isEmpty()) {
            return forecasts;
        }
        List<LinkForecast> out = new ArrayList<>(forecasts.size());
        for (LinkForecast f : forecasts) {
            Optional<ScenarioOverride> o = overrides.stream()
                    .filter(x -> x.linkId().equals(f.linkId())
                            && (x.horizonMinutes() == null || x.horizonMinutes() == f.horizonMinutes()))
                    .findFirst();
            if (o.isEmpty()) {
                out.add(f);
                continue;
            }
            ScenarioOverride s = o.get();
            double p = s.predictedUtilization();
            List<Factor> factors = new ArrayList<>();
            factors.add(new Factor("scenario-override", p, p - f.predictedUtilization(),
                    "DEMO SCENARIO injected by " + s.createdBy() + ": " + s.note()));
            if (f.factors() != null) {
                factors.addAll(f.factors());
            }
            List<Counterfactual> cfs = new ArrayList<>();
            cfs.add(new Counterfactual(String.format("Without the injected demo scenario the %s forecast would be %.0f%%",
                    f.source(), f.predictedUtilization() * 100), f.predictedUtilization()));
            if (f.counterfactuals() != null) {
                cfs.addAll(f.counterfactuals());
            }
            out.add(new LinkForecast(f.linkId(), f.horizonMinutes(), p, clamp(p - 0.05, 0, 1.5), clamp(p + 0.05, 0, 1.5),
                    RuleBasedPredictionProvider.riskFor(p, threshold), s.confidence(), f.source() + "+SCENARIO",
                    f.modelVersion(), factors, cfs));
        }
        return out;
    }

    public Map<String, Object> startLiveTraffic(LiveTrafficCommand cmd, String actor) {
        TopologyIndex t = topology.require();
        for (String cls : cmd.demands().keySet()) {
            if (t.trafficClass(cls).isEmpty()) {
                throw new BadRequestException("Unknown traffic class " + cls);
            }
        }
        List<TrafficFlow> flows = traffic.flows(t, cmd.demands());
        int duration = cmd.durationSec() == null ? 600 : cmd.durationSec();
        Map<String, Object> res = agent.startLiveTraffic(new LiveTrafficRequest(flows, duration));
        audit.record(AuditType.LIVE_TRAFFIC, actor, null, null,
                "Live demo traffic started (" + flows.size() + " UDP streams, " + duration + " s)", cmd.demands());
        return res;
    }

    public Map<String, Object> stopLiveTraffic(String actor) {
        Map<String, Object> res = agent.stopLiveTraffic();
        audit.record(AuditType.LIVE_TRAFFIC, actor, null, null, "Live demo traffic stopped", null);
        return res;
    }

    private void purgeExpired() {
        Instant now = Instant.now();
        overrides.removeIf(o -> o.expiresAt().isBefore(now));
    }
}
