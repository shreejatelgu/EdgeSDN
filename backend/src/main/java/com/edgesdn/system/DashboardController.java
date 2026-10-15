package com.edgesdn.system;

import com.edgesdn.enforcement.Enforcement;
import com.edgesdn.enforcement.EnforcementService;
import com.edgesdn.policy.ApprovalMode;
import com.edgesdn.policy.PolicyService;
import com.edgesdn.prediction.PredictionModels.ForecastRun;
import com.edgesdn.prediction.PredictionModels.LinkForecast;
import com.edgesdn.prediction.PredictionService;
import com.edgesdn.recommendation.Recommendation;
import com.edgesdn.recommendation.RecommendationService;
import com.edgesdn.telemetry.TelemetryService;
import com.edgesdn.telemetry.TelemetryService.GroupDemand;
import com.edgesdn.telemetry.TelemetryService.LinkUtil;
import com.edgesdn.telemetry.TelemetryService.TelemetrySnapshot;
import com.edgesdn.topology.TopologyIndex;
import com.edgesdn.topology.TopologyModels.LinkInfo;
import com.edgesdn.topology.TopologyModels.Topology;
import com.edgesdn.topology.TopologyService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** One call that gives the Angular dashboard everything it renders. */
@RestController
public class DashboardController {

    public record LinkView(String id, String a, String b, double capacityMbps, Double utilization, Double mbps,
                           Double predictedPeak, Integer peakHorizon, Double risk) {
    }

    public record DashboardView(boolean topologyLoaded, String topologyError, Topology topology, List<LinkView> links,
                                List<GroupDemand> groups, Instant telemetryAt, boolean telemetryStale,
                                String telemetryError, String provider, Instant forecastAt,
                                List<Recommendation> openRecommendations, List<Enforcement> activeEnforcements,
                                ApprovalMode approvalMode) {
    }

    private final TopologyService topology;
    private final TelemetryService telemetry;
    private final PredictionService predictions;
    private final RecommendationService recommendations;
    private final EnforcementService enforcements;
    private final PolicyService policies;

    public DashboardController(TopologyService topology, TelemetryService telemetry, PredictionService predictions,
                               RecommendationService recommendations, EnforcementService enforcements,
                               PolicyService policies) {
        this.topology = topology;
        this.telemetry = telemetry;
        this.predictions = predictions;
        this.recommendations = recommendations;
        this.enforcements = enforcements;
        this.policies = policies;
    }

    @GetMapping("/api/dashboard")
    public DashboardView dashboard() {
        Optional<TopologyIndex> t = topology.current();
        TelemetrySnapshot snap = telemetry.latest();
        ForecastRun run = predictions.latest();

        Map<String, LinkUtil> util = new HashMap<>();
        snap.links().forEach(l -> util.put(l.linkId(), l));
        Map<String, LinkForecast> peak = new HashMap<>();
        if (run != null) {
            for (LinkForecast f : run.forecasts()) {
                peak.merge(f.linkId(), f, (x, y) -> y.predictedUtilization() > x.predictedUtilization() ? y : x);
            }
        }
        List<LinkView> links = new ArrayList<>();
        if (t.isPresent()) {
            for (LinkInfo l : t.get().links()) {
                LinkUtil u = util.get(l.id());
                LinkForecast f = peak.get(l.id());
                links.add(new LinkView(l.id(), l.a(), l.b(), l.capacityMbps(),
                        u == null ? null : u.utilization(), u == null ? null : u.mbps(),
                        f == null ? null : f.predictedUtilization(), f == null ? null : f.horizonMinutes(),
                        f == null ? null : f.congestionRisk()));
            }
        }
        return new DashboardView(t.isPresent(), topology.lastError(), t.map(TopologyIndex::topology).orElse(null),
                links, snap.groups(), snap.polledAt(), snap.stale(), snap.lastError(),
                run == null ? predictions.providerInfo().get("active").toString() : run.provider(),
                run == null ? null : run.generatedAt(), recommendations.open(), enforcements.active(),
                policies.get().getApprovalMode());
    }
}
