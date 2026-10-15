package com.edgesdn.recommendation;

import com.edgesdn.twin.KpiSummary;

/** A simulated candidate together with the KPIs it was compared against. score is null if simulation failed. */
public record Scored(RecommendationCandidate entity, CandidateAction action, KpiSummary baseKpi, KpiSummary kpi,
                     ScoringService.ScoreResult score) {
}
