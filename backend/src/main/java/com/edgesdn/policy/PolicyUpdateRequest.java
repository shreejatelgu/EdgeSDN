package com.edgesdn.policy;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record PolicyUpdateRequest(
        @NotNull ApprovalMode approvalMode,
        @NotNull @DecimalMin("0.0") @DecimalMax("1.0") Double weightImprovement,
        @NotNull @DecimalMin("0.0") @DecimalMax("1.0") Double weightConfidence,
        @NotNull @DecimalMin("0.0") @DecimalMax("1.0") Double weightRisk,
        @NotNull @DecimalMin("0.1") @DecimalMax("1.5") Double congestionUtilThreshold,
        @NotNull @DecimalMin("0.0") @DecimalMax("1.0") Double congestionRiskThreshold,
        @NotNull @DecimalMin("0.0") @DecimalMax("1.0") Double minImprovement,
        @NotNull @Min(1) @Max(5) Integer maxCandidates,
        @NotNull @DecimalMin("0.1") @DecimalMax("0.95") Double rateLimitFraction,
        @NotNull @DecimalMin("0.0") @DecimalMax("1.0") Double autoMaxRisk,
        @NotNull @DecimalMin("-1.0") @DecimalMax("1.0") Double autoMinScore,
        @NotNull @DecimalMin("0.0") @DecimalMax("1.0") Double autoMinConfidence,
        @Size(max = 200) String autoAllowedActions,
        @NotNull @Min(0) @Max(60) Integer autoMaxPerHour,
        @NotNull @Min(1) @Max(240) Integer recommendationTtlMinutes,
        @NotNull @Min(30) @Max(3600) Integer monitorWindowSec,
        @NotNull @DecimalMin("1.0") @DecimalMax("500.0") Double rollbackUtilIncreasePct,
        @NotNull @DecimalMin("1.0") @DecimalMax("1000.0") Double rollbackLatencyIncreasePct,
        @NotNull @DecimalMin("0.1") @DecimalMax("100.0") Double rollbackLossPct) {
}
