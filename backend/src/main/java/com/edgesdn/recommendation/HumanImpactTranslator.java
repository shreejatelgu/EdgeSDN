package com.edgesdn.recommendation;

import com.edgesdn.prediction.PredictionModels.Factor;
import com.edgesdn.prediction.PredictionModels.LinkForecast;
import com.edgesdn.topology.TopologyIndex;
import com.edgesdn.topology.TopologyModels.HostGroup;
import com.edgesdn.topology.TopologyModels.TrafficClass;
import com.edgesdn.twin.KpiSummary;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static com.edgesdn.common.MathUtil.pct;

/** Converts technical KPI changes into a plain-language impact statement for the administrator. */
@Component
public class HumanImpactTranslator {

    public String translate(TopologyIndex t, LinkForecast f, Scored selected, Map<String, List<String>> classPaths) {
        List<String> lines = new ArrayList<>();
        String driver = f.factors() == null ? null : f.factors().stream()
                .filter(x -> x.name().startsWith("event:") || x.name().equals("scenario-override"))
                .max((x, y) -> Double.compare(x.contribution(), y.contribution()))
                .map(Factor::name).map(n -> n.startsWith("event:") ? "the event '" + n.substring(6) + "'" : "a demo scenario")
                .orElse(null);
        lines.add(String.format("Without action, link %s is expected to be about %s loaded in ~%d minutes%s.",
                f.linkId(), pct(f.predictedUtilization()), f.horizonMinutes(),
                driver == null ? "" : ", mainly because of " + driver));

        CandidateAction a = selected.action();
        HostGroup g = a.trafficClass().destination();
        if (a.type() == ActionType.REROUTE) {
            lines.add(String.format("Downloads from the %s to %s (~%d users) will take the alternate path %s.",
                    a.trafficClass().source().label(), g.label(), g.users(), String.join(" > ", a.path())));
        } else {
            double b = selected.baseKpi().classDeliveredMbps().getOrDefault(a.trafficClass().id(), 0.0);
            double c = selected.kpi().classDeliveredMbps().getOrDefault(a.trafficClass().id(), 0.0);
            lines.add(String.format("Traffic to %s (~%d users) will be capped at %.1f Mbps; in the twin their throughput "
                            + "went from %.1f to %.1f Mbps, so large downloads there may be slower.",
                    g.label(), g.users(), a.rateKbps() / 1000.0, b, c));
        }

        KpiSummary base = selected.baseKpi();
        KpiSummary cand = selected.kpi();
        lines.add(String.format("Expected effect (digital twin): link %s load %s -> %s; busiest link %s -> %s; "
                        + "average response time for the other users %s -> %s; their packet loss %s -> %s.",
                f.linkId(), pct(base.targetLinkUtil()), pct(cand.targetLinkUtil()), pct(base.maxLinkUtil()),
                pct(cand.maxLinkUtil()), ExplanationService.ms(base.protectedLatencyMs()),
                ExplanationService.ms(cand.protectedLatencyMs()), ExplanationService.lossPct(base.protectedLossPct()),
                ExplanationService.lossPct(cand.protectedLossPct())));

        int protectedUsers = 0;
        List<String> labels = new ArrayList<>();
        for (TrafficClass c : t.trafficClasses()) {
            if (c.id().equals(a.trafficClass().id()) && a.type() == ActionType.RATE_LIMIT) {
                continue;
            }
            List<String> path = classPaths.getOrDefault(c.id(), t.baselinePath(c));
            if (t.pathUsesLink(path, f.linkId())) {
                protectedUsers += c.destination().users();
                labels.add(c.destination().label());
            }
        }
        if (!labels.isEmpty()) {
            lines.add(String.format("Users who benefit: about %d (%s).", protectedUsers, String.join(", ", labels)));
        }
        return String.join("\n", lines);
    }
}
