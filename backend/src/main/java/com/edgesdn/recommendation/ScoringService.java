package com.edgesdn.recommendation;

import com.edgesdn.config.EdgeProperties;
import com.edgesdn.policy.PolicyConfig;
import com.edgesdn.routing.FlowSpec;
import com.edgesdn.topology.TopologyIndex;
import com.edgesdn.twin.KpiSummary;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

import static com.edgesdn.common.MathUtil.clamp;
import static com.edgesdn.common.MathUtil.clamp01;
import static com.edgesdn.common.MathUtil.nz;
import static com.edgesdn.common.MathUtil.round;

/**
 * Transparent weighted scoring (all terms in [0,1], weights from PolicyConfig):
 * <pre>
 * Score = wImprovement * KPIImprovement + wConfidence * Confidence - wRisk * Risk
 *
 * rel(b,c) = clamp((b - c) / b, -1, 1)                          (0 if b is ~0 or unknown)
 * RawImprovement = weighted mean of
 *     rel(targetLinkUtil), rel(maxLinkUtil), rel(protectedLatency),
 *     lossGain = clamp((bLoss - cLoss) / max(bLoss, 1), -1, 1)  (0 if both &lt; 0.5 %)
 * KPIImprovement = clamp(RawImprovement, 0, 1)
 *
 * Risk = weighted mean of
 *     disruption     = demand of the affected class / total demand
 *     pathStretch    = (altHops - baseHops) / baseHops            (REROUTE)
 *     coreTouch      = share of installed rules on CORE switches
 *     lossSpike      = clamp((cLoss - bLoss) / 10 pp, 0, 1)
 *     priorityImpact = RATE_LIMIT: priorityWeight x throughput reduction of the class
 *                      REROUTE:    0.1 x priorityWeight            (path change on a live class)
 *   priorityWeight: HIGH 1.0, MEDIUM 0.5, LOW 0.2
 *
 * Confidence = confidence of the prediction that triggered the recommendation.
 * </pre>
 * Sub-weights come from application.yml (edge.improvement.*, edge.risk.*).
 */
@Component
public class ScoringService {

    private final EdgeProperties props;

    public ScoringService(EdgeProperties props) {
        this.props = props;
    }

    public record ScoreResult(double rawImprovement, double kpiImprovement, double risk, double confidence,
                              double score, Map<String, Double> improvementBreakdown,
                              Map<String, Double> riskBreakdown) {
    }

    public ScoreResult score(TopologyIndex t, CandidateAction a, KpiSummary base, KpiSummary cand, double confidence,
                             Map<String, Double> classDemand, PolicyConfig p) {
        // ---- KPI improvement
        EdgeProperties.Improvement w = props.getImprovement();
        double gTarget = rel(base.targetLinkUtil(), cand.targetLinkUtil());
        double gMax = rel(base.maxLinkUtil(), cand.maxLinkUtil());
        double gLat = rel(base.protectedLatencyMs(), cand.protectedLatencyMs());
        double gLoss = lossGain(base.protectedLossPct(), cand.protectedLossPct());
        double wSum = w.getTargetLinkUtil() + w.getMaxLinkUtil() + w.getLatency() + w.getLoss();
        double raw = wSum <= 0 ? 0 : (w.getTargetLinkUtil() * gTarget + w.getMaxLinkUtil() * gMax
                + w.getLatency() * gLat + w.getLoss() * gLoss) / wSum;
        double kpi = clamp01(raw);

        Map<String, Double> imp = new LinkedHashMap<>();
        imp.put("targetLinkUtilGain", round(gTarget, 4));
        imp.put("maxLinkUtilGain", round(gMax, 4));
        imp.put("latencyGain", round(gLat, 4));
        imp.put("lossGain", round(gLoss, 4));

        // ---- risk
        String cls = a.trafficClass().id();
        double total = classDemand.values().stream().mapToDouble(Double::doubleValue).sum();
        double disruption = total > 0 ? clamp01(classDemand.getOrDefault(cls, 0.0) / total) : 0;
        double stretch = 0;
        if (a.type() == ActionType.REROUTE && a.baselinePath() != null && a.baselinePath().size() > 1) {
            int baseHops = a.baselinePath().size() - 1;
            int altHops = a.path().size() - 1;
            stretch = clamp01((altHops - baseHops) / (double) baseHops);
        }
        long coreRules = a.flows().stream().map(FlowSpec::switchName).filter(t::isCore).count();
        double coreTouch = a.flows().isEmpty() ? 0 : (double) coreRules / a.flows().size();
        double lossSpike = clamp01(Math.max(0, nz(cand.protectedLossPct()) - nz(base.protectedLossPct())) / 10.0);
        double prioW = priorityWeight(a.trafficClass().destination().priority());
        double priorityImpact;
        if (a.type() == ActionType.RATE_LIMIT) {
            double b = base.classDeliveredMbps().getOrDefault(cls, 0.0);
            double c = cand.classDeliveredMbps().getOrDefault(cls, 0.0);
            double reduction = b > 0 ? clamp01(1 - c / b) : 0;
            priorityImpact = clamp01(prioW * reduction);
        } else {
            priorityImpact = 0.1 * prioW;
        }
        EdgeProperties.Risk rw = props.getRisk();
        double rSum = rw.getDisruption() + rw.getPathStretch() + rw.getCoreTouch() + rw.getLossSpike()
                + rw.getPriorityImpact();
        double risk = rSum <= 0 ? 0 : clamp01((rw.getDisruption() * disruption + rw.getPathStretch() * stretch
                + rw.getCoreTouch() * coreTouch + rw.getLossSpike() * lossSpike
                + rw.getPriorityImpact() * priorityImpact) / rSum);

        Map<String, Double> rb = new LinkedHashMap<>();
        rb.put("disruption", round(disruption, 4));
        rb.put("pathStretch", round(stretch, 4));
        rb.put("coreTouch", round(coreTouch, 4));
        rb.put("lossSpike", round(lossSpike, 4));
        rb.put("priorityImpact", round(priorityImpact, 4));

        double conf = clamp01(confidence);
        double score = p.getWeightImprovement() * kpi + p.getWeightConfidence() * conf - p.getWeightRisk() * risk;
        return new ScoreResult(round(raw, 4), round(kpi, 4), round(risk, 4), round(conf, 4), round(score, 4), imp, rb);
    }

    static double rel(Double b, Double c) {
        if (b == null || c == null || b < 1e-9) {
            return 0;
        }
        return clamp((b - c) / b, -1, 1);
    }

    static double lossGain(Double b, Double c) {
        if (b == null || c == null) {
            return 0;
        }
        if (b < 0.5 && c < 0.5) {
            return 0;
        }
        return clamp((b - c) / Math.max(b, 1.0), -1, 1);
    }

    public static double priorityWeight(String priority) {
        if ("HIGH".equalsIgnoreCase(priority)) {
            return 1.0;
        }
        if ("MEDIUM".equalsIgnoreCase(priority)) {
            return 0.5;
        }
        return 0.2;
    }
}
