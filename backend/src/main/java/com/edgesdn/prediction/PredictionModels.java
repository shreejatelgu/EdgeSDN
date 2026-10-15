package com.edgesdn.prediction;

import java.time.Instant;
import java.util.List;

/**
 * Data contract shared by every PredictionProvider. The same JSON shapes are used on the wire
 * for the external ML service (POST /api/v1/predict), see SETUP_GUIDE.md "ML integration contract".
 */
public final class PredictionModels {

    private PredictionModels() {
    }

    public record UtilPoint(Instant ts, double utilization) {
    }

    /** groups = client groups whose (current) path crosses this link. */
    public record LinkHistory(String linkId, double capacityMbps, List<String> groups, List<UtilPoint> history) {
    }

    public record EventInfo(Long id, String name, String type, Instant startTime, int durationMinutes,
                            double expectedIntensity, List<String> affectedGroups) {
    }

    public record PredictionInput(Instant generatedAt, List<Integer> horizonsMinutes, double congestionThreshold,
                                  List<LinkHistory> links, List<EventInfo> events) {
    }

    /** A factual-explanation term: contribution is in utilisation units (0.10 = +10 percentage points). */
    public record Factor(String name, double value, double contribution, String description) {
    }

    public record Counterfactual(String description, double predictedUtilization) {
    }

    public record LinkForecast(String linkId, int horizonMinutes, double predictedUtilization, double lower,
                               double upper, double congestionRisk, double confidence, String source,
                               String modelVersion, List<Factor> factors, List<Counterfactual> counterfactuals) {
    }

    public record ForecastRun(String runId, Instant generatedAt, String provider, boolean fallbackUsed,
                              String fallbackReason, List<LinkForecast> forecasts) {
    }

    public record ForecastCompletedEvent(ForecastRun run) {
    }
}
