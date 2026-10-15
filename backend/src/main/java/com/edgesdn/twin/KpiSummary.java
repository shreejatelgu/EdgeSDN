package com.edgesdn.twin;

import java.util.List;
import java.util.Map;

/**
 * KPIs of one twin run. "Protected" traffic = all classes except those deliberately rate-limited by the
 * candidate (their reduced throughput is accounted for in Risk, not as "loss").
 */
public record KpiSummary(Double targetLinkUtil,
                         double maxLinkUtil,
                         Double protectedLatencyMs,
                         Double protectedLossPct,
                         double protectedDeliveredMbps,
                         double protectedOfferedMbps,
                         Map<String, Double> classDeliveredMbps,
                         Map<String, Double> classLossPct,
                         Map<String, Double> linkUtilization,
                         List<String> warnings) {
}
