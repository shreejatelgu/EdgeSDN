package com.edgesdn.policy;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.Arrays;
import java.util.List;

/** Single-row table (id = 1) holding every administrator-tunable decision parameter. */
@Entity
@Table(name = "policy_config")
@Getter
@Setter
@NoArgsConstructor
public class PolicyConfig {

    public static final long SINGLETON_ID = 1L;

    @Id
    private Long id = SINGLETON_ID;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ApprovalMode approvalMode = ApprovalMode.MANUAL;

    // Score = wImprovement * KPIImprovement + wConfidence * Confidence - wRisk * Risk
    private double weightImprovement = 0.5;
    private double weightConfidence = 0.2;
    private double weightRisk = 0.3;

    // Congestion detection
    private double congestionUtilThreshold = 0.80;
    private double congestionRiskThreshold = 0.50;

    // Candidate generation / selection
    private double minImprovement = 0.05;
    private int maxCandidates = 3;
    private double rateLimitFraction = 0.60;

    // Auto-approval (only used in AUTO_LOW_RISK mode)
    private double autoMaxRisk = 0.25;
    private double autoMinScore = 0.35;
    private double autoMinConfidence = 0.60;
    @Column(length = 200)
    private String autoAllowedActions = "REROUTE";
    private int autoMaxPerHour = 3;

    private int recommendationTtlMinutes = 15;

    // Post-enforcement monitoring and rollback
    private int monitorWindowSec = 180;
    private double rollbackUtilIncreasePct = 15.0;
    private double rollbackLatencyIncreasePct = 50.0;
    private double rollbackLossPct = 5.0;

    private Instant updatedAt;
    @Column(length = 100)
    private String updatedBy;

    public List<String> allowedAutoActionList() {
        if (autoAllowedActions == null || autoAllowedActions.isBlank()) {
            return List.of();
        }
        return Arrays.stream(autoAllowedActions.split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).map(String::toUpperCase).toList();
    }
}
