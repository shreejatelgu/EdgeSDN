package com.edgesdn.recommendation;

import com.edgesdn.policy.PolicyConfig;
import com.edgesdn.prediction.PredictionModels.Factor;
import com.edgesdn.prediction.PredictionModels.LinkForecast;
import com.edgesdn.recommendation.ScoringService.ScoreResult;
import com.edgesdn.twin.KpiSummary;
import org.springframework.stereotype.Component;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static com.edgesdn.common.MathUtil.pct;

/**
 * Produces the textual explanations shown to the administrator. Every statement is derived from
 * numbers stored with the recommendation (forecast factors, twin KPIs, score components), so the
 * explanation can be checked against the data.
 */
@Component
public class ExplanationService {

    /** Factual explanation of the prediction: value, range, and top contributing factors. */
    public String factual(LinkForecast f) {
        String drivers = f.factors() == null ? "" : f.factors().stream()
                .sorted(Comparator.comparingDouble((Factor x) -> Math.abs(x.contribution())).reversed())
                .limit(3)
                .map(Factor::description)
                .collect(Collectors.joining("; "));
        return String.format("Link %s is predicted to reach %s in %d min (range %s-%s, confidence %s, "
                        + "congestion risk %.2f, source %s). Main drivers: %s.",
                f.linkId(), pct(f.predictedUtilization()), f.horizonMinutes(), pct(f.lower()), pct(f.upper()),
                pct(f.confidence()), f.congestionRisk(), f.source(), drivers.isEmpty() ? "n/a" : drivers);
    }

    public String whySelected(Scored s, PolicyConfig p) {
        ScoreResult r = s.score();
        return String.format("Selected: %s. Score %.3f = %.2f x KPIImprovement %.3f + %.2f x Confidence %.3f - %.2f x Risk %.3f. "
                        + "Digital twin: %s.",
                s.action().description(), r.score(), p.getWeightImprovement(), r.kpiImprovement(),
                p.getWeightConfidence(), r.confidence(), p.getWeightRisk(), r.risk(), kpiDelta(s.baseKpi(), s.kpi()));
    }

    public String whyNotAlternative(Scored sel, Scored alt, PolicyConfig p) {
        if (alt == null) {
            return "No alternative candidate was available (only one feasible action for this link).";
        }
        RecommendationCandidate a = alt.entity();
        if (a.getStatus() == CandidateStatus.SIMULATION_FAILED) {
            return String.format("Alternative '%s' could not be simulated in the digital twin (%s), so it was not "
                    + "eligible: no action reaches enforcement without twin validation.", alt.action().description(), a.getNote());
        }
        if (a.getStatus() == CandidateStatus.NO_GAIN) {
            return String.format("Alternative '%s' was not selected because the twin showed a raw KPI change of %.3f, "
                            + "below the minimum improvement of %.3f. Twin: %s.",
                    alt.action().description(), alt.score().rawImprovement(), p.getMinImprovement(),
                    kpiDelta(alt.baseKpi(), alt.kpi()));
        }
        ScoreResult s = sel.score();
        ScoreResult r = alt.score();
        double dImp = p.getWeightImprovement() * (s.kpiImprovement() - r.kpiImprovement());
        double dRisk = p.getWeightRisk() * (r.risk() - s.risk());
        String dominant = Math.abs(dImp) >= Math.abs(dRisk)
                ? String.format("its weighted KPI improvement was %.3f lower (%.3f vs %.3f)", dImp, r.kpiImprovement(), s.kpiImprovement())
                : String.format("its weighted risk was %.3f higher (%.3f vs %.3f; largest risk factor: %s)", dRisk,
                r.risk(), s.risk(), topRisk(r.riskBreakdown()));
        return String.format("Alternative '%s' scored %.3f vs %.3f. Main reason: %s. Twin: %s.",
                alt.action().description(), r.score(), s.score(), dominant, kpiDelta(alt.baseKpi(), alt.kpi()));
    }

    /**
     * Bounded counterfactuals on the decision: the smallest change to the alternative (within [0,1]) or to
     * the risk weight that would have flipped the choice. Values outside the valid range are reported as such.
     */
    public String counterfactual(Scored sel, Scored alt, PolicyConfig p) {
        if (alt == null || alt.score() == null || alt.entity().getStatus() != CandidateStatus.SELECTABLE) {
            return "No eligible alternative exists, so no decision counterfactual applies.";
        }
        ScoreResult s = sel.score();
        ScoreResult a = alt.score();
        StringBuilder sb = new StringBuilder();
        double w1 = p.getWeightImprovement();
        double w2 = p.getWeightConfidence();
        double w3 = p.getWeightRisk();
        if (w3 > 0) {
            double riskNeeded = (w1 * a.kpiImprovement() + w2 * a.confidence() - s.score()) / w3;
            if (riskNeeded >= 0 && riskNeeded < a.risk()) {
                sb.append(String.format("If the alternative's risk were below %.3f (it is %.3f), it would have been selected. ",
                        riskNeeded, a.risk()));
            } else if (riskNeeded < 0) {
                sb.append("Even with zero risk the alternative would not have been selected. ");
            }
        }
        if (w1 > 0) {
            double kpiNeeded = (s.score() - w2 * a.confidence() + w3 * a.risk()) / w1;
            if (kpiNeeded <= 1.0) {
                sb.append(String.format("If its KPI improvement were above %.3f (it is %.3f), it would have been selected. ",
                        kpiNeeded, a.kpiImprovement()));
            } else {
                sb.append("No KPI improvement within [0,1] would make it win under the current weights. ");
            }
        }
        double dr = a.risk() - s.risk();
        if (Math.abs(dr) > 1e-6) {
            double w3Flip = w1 * (a.kpiImprovement() - s.kpiImprovement()) / dr;
            if (w3Flip >= 0 && w3Flip <= 1) {
                sb.append(String.format("With risk weight %s %.3f (currently %.2f) the choice would flip.",
                        dr > 0 ? "below" : "above", w3Flip, w3));
            }
        }
        return sb.toString().trim();
    }

    public String noAction(List<Scored> all, PolicyConfig p) {
        if (all.isEmpty()) {
            return "No candidate could be generated: every class crossing the link already has an active action, "
                    + "or no alternate path / eligible class exists.";
        }
        String details = all.stream().map(s -> s.score() == null
                        ? s.action().description() + ": twin simulation failed (" + s.entity().getNote() + ")"
                        : String.format("%s: raw KPI change %.3f", s.action().description(), s.score().rawImprovement()))
                .collect(Collectors.joining("; "));
        return String.format("No candidate improved KPIs by more than %.3f in the digital twin, so no action is "
                + "recommended. %s", p.getMinImprovement(), details);
    }

    static String kpiDelta(KpiSummary b, KpiSummary c) {
        if (b == null || c == null) {
            return "n/a";
        }
        return String.format("target link %s -> %s, max link %s -> %s, protected latency %s -> %s, protected loss %s -> %s",
                pct(b.targetLinkUtil()), pct(c.targetLinkUtil()), pct(b.maxLinkUtil()), pct(c.maxLinkUtil()),
                ms(b.protectedLatencyMs()), ms(c.protectedLatencyMs()),
                lossPct(b.protectedLossPct()), lossPct(c.protectedLossPct()));
    }

    private static String topRisk(Map<String, Double> rb) {
        return rb.entrySet().stream().max(Map.Entry.comparingByValue())
                .map(e -> String.format("%s %.2f", e.getKey(), e.getValue())).orElse("n/a");
    }

    static String ms(Double v) {
        return v == null ? "n/a" : String.format("%.1f ms", v);
    }

    static String lossPct(Double v) {
        return v == null ? "n/a" : String.format("%.1f%%", v);
    }
}
