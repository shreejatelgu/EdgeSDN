package com.edgesdn.prediction;

import com.edgesdn.prediction.PredictionModels.Counterfactual;
import com.edgesdn.prediction.PredictionModels.EventInfo;
import com.edgesdn.prediction.PredictionModels.Factor;
import com.edgesdn.prediction.PredictionModels.LinkForecast;
import com.edgesdn.prediction.PredictionModels.LinkHistory;
import com.edgesdn.prediction.PredictionModels.PredictionInput;
import com.edgesdn.prediction.PredictionModels.UtilPoint;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.edgesdn.common.MathUtil.clamp;
import static com.edgesdn.common.MathUtil.sigmoid;

/**
 * Non-ML baseline forecaster (placeholder until the ML service is integrated).
 * <pre>
 * predicted(h) = EWMA(recent utilisation)
 *              + clamp(slope_per_min * h, -0.3, +0.3)
 *              + sum over events active at now+h of  intensity * typeFactor * activity * affectedShare
 *   activity      = 1 inside the event, linear ramp 0->1 during the 10 min before it starts
 *   affectedShare = (#affected groups on the link) / (#groups on the link)
 * risk        = sigmoid((predicted - threshold) / 0.04)
 * uncertainty = 0.05 + stdev + 0.02 * h/15 (+0.05 when an event contributes)
 * confidence  = clamp(min(1, n/12) * (1 - min(0.6, uncertainty)), 0.2, 0.95)
 * </pre>
 * Because the model is additive, its factual explanation (each term) and counterfactuals
 * ("without event X the prediction would be Y") are exact rather than approximated.
 */
@Component
public class RuleBasedPredictionProvider implements PredictionProvider {

    public static final String NAME = "RULE_BASED";
    public static final String VERSION = "rule-v1";

    static final Map<String, Double> TYPE_FACTOR = Map.of(
            "EXAM", 0.7, "PLACEMENT", 0.6, "FESTIVAL", 0.8, "OTHER", 0.4);
    static final double RAMP_MINUTES = 10.0;
    static final double EWMA_ALPHA = 0.3;
    static final double RISK_SCALE = 0.04;
    static final double MAX_UTIL = 1.5;

    private record Stats(int n, double ewma, double slopePerMin, double stdev) {
    }

    @Override
    public String name() {
        return NAME;
    }

    @Override
    public List<LinkForecast> forecast(PredictionInput in) {
        List<LinkForecast> out = new ArrayList<>();
        for (LinkHistory link : in.links()) {
            Stats s = stats(link.history(), in.generatedAt());
            for (int h : in.horizonsMinutes()) {
                out.add(forecastOne(link, s, h, in));
            }
        }
        return out;
    }

    private static Stats stats(List<UtilPoint> pts, Instant now) {
        int n = pts == null ? 0 : pts.size();
        if (n == 0) {
            return new Stats(0, 0, 0, 0);
        }
        double e = pts.get(0).utilization();
        double sum = 0;
        for (int i = 0; i < n; i++) {
            double u = pts.get(i).utilization();
            if (i > 0) {
                e = EWMA_ALPHA * u + (1 - EWMA_ALPHA) * e;
            }
            sum += u;
        }
        double mean = sum / n;
        double var = 0;
        for (UtilPoint p : pts) {
            var += Math.pow(p.utilization() - mean, 2);
        }
        double stdev = Math.sqrt(var / n);

        double slope = 0;
        if (n >= 3) {
            double[] x = new double[n];
            double xMean = 0;
            for (int i = 0; i < n; i++) {
                x[i] = -Duration.between(pts.get(i).ts(), now).toMillis() / 60000.0;
                xMean += x[i];
            }
            xMean /= n;
            double num = 0;
            double den = 0;
            for (int i = 0; i < n; i++) {
                num += (x[i] - xMean) * (pts.get(i).utilization() - mean);
                den += (x[i] - xMean) * (x[i] - xMean);
            }
            slope = den < 1e-9 ? 0 : num / den;
        }
        return new Stats(n, e, slope, stdev);
    }

    private static LinkForecast forecastOne(LinkHistory link, Stats s, int h, PredictionInput in) {
        Instant target = in.generatedAt().plus(Duration.ofMinutes(h));
        double trend = clamp(s.slopePerMin() * h, -0.3, 0.3);

        List<Factor> factors = new ArrayList<>();
        factors.add(new Factor("recentBaseline", s.ewma(), s.ewma(), String.format(
                "Smoothed recent utilisation is %.0f%% (%d samples)", s.ewma() * 100, s.n())));
        factors.add(new Factor("trend", s.slopePerMin(), trend, String.format(
                "Recent trend %+.2f pp/min projected over %d min gives %+.0f pp", s.slopePerMin() * 100, h, trend * 100)));

        Set<String> linkGroups = new HashSet<>(link.groups() == null ? List.of() : link.groups());
        double uplift = 0;
        List<Map.Entry<String, Double>> eventTerms = new ArrayList<>();
        for (EventInfo e : in.events()) {
            if (linkGroups.isEmpty()) {
                break;
            }
            List<String> affected = e.affectedGroups() == null || e.affectedGroups().isEmpty()
                    ? List.copyOf(linkGroups)
                    : e.affectedGroups().stream().filter(linkGroups::contains).toList();
            if (affected.isEmpty()) {
                continue;
            }
            double activity = activity(e, target);
            if (activity <= 0) {
                continue;
            }
            double share = (double) affected.size() / linkGroups.size();
            double typeFactor = TYPE_FACTOR.getOrDefault(e.type(), 0.4);
            double c = e.expectedIntensity() * typeFactor * activity * share;
            uplift += c;
            eventTerms.add(Map.entry(e.name(), c));
            factors.add(new Factor("event:" + e.name(), e.expectedIntensity(), c, String.format(
                    "%s '%s' (intensity %.2f x type factor %.1f x activity %.2f x share %.2f of groups on link) adds %+.0f pp",
                    e.type(), e.name(), e.expectedIntensity(), typeFactor, activity, share, c * 100)));
        }

        double raw = s.ewma() + trend + uplift;
        double predicted = clamp(raw, 0, MAX_UTIL);
        double uncertainty = 0.05 + s.stdev() + 0.02 * (h / 15.0) + (uplift > 0 ? 0.05 : 0);
        double dataFactor = s.n() == 0 ? 0.3 : Math.min(1.0, s.n() / 12.0);
        double confidence = clamp(dataFactor * (1 - Math.min(0.6, uncertainty)), 0.2, 0.95);
        double threshold = in.congestionThreshold();
        double risk = sigmoid((predicted - threshold) / RISK_SCALE);

        List<Counterfactual> cfs = new ArrayList<>();
        for (Map.Entry<String, Double> t : eventTerms) {
            double without = clamp(raw - t.getValue(), 0, MAX_UTIL);
            cfs.add(new Counterfactual(String.format("Without event '%s' the prediction would be %.0f%% (%s the %.0f%% threshold)",
                    t.getKey(), without * 100, without >= threshold ? "still above" : "below", threshold * 100), without));
        }
        if (Math.abs(trend) >= 0.02) {
            double flat = clamp(raw - trend, 0, MAX_UTIL);
            cfs.add(new Counterfactual(String.format("With a flat recent trend the prediction would be %.0f%%", flat * 100), flat));
        }
        if (predicted >= threshold) {
            cfs.add(new Counterfactual(String.format(
                    "Load must fall by %.0f percentage points for the link to leave the congestion zone",
                    (predicted - threshold) * 100 + 1), threshold - 0.01));
        }

        return new LinkForecast(link.linkId(), h, predicted, clamp(predicted - uncertainty, 0, MAX_UTIL),
                clamp(predicted + uncertainty, 0, MAX_UTIL), risk, confidence, NAME, VERSION, factors, cfs);
    }

    static double activity(EventInfo e, Instant t) {
        Instant start = e.startTime();
        Instant end = start.plus(Duration.ofMinutes(e.durationMinutes()));
        if (!t.isBefore(start) && !t.isAfter(end)) {
            return 1.0;
        }
        if (t.isBefore(start)) {
            double minutesBefore = Duration.between(t, start).toSeconds() / 60.0;
            return minutesBefore <= RAMP_MINUTES ? 1.0 - minutesBefore / RAMP_MINUTES : 0.0;
        }
        return 0.0;
    }

    public static double riskFor(double predicted, double threshold) {
        return sigmoid((predicted - threshold) / RISK_SCALE);
    }
}
