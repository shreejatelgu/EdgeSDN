package com.edgesdn.recommendation;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

@Entity
@Table(name = "recommendation", indexes = {
        @Index(name = "idx_rec_status", columnList = "status"),
        @Index(name = "idx_rec_link", columnList = "target_link_id")
})
@Getter
@Setter
@NoArgsConstructor
public class Recommendation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Instant createdAt;
    private Instant updatedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private RecommendationStatus status;

    // ---- prediction that triggered it
    @Column(name = "target_link_id", nullable = false, length = 64)
    private String targetLinkId;
    private int horizonMinutes;
    private double predictedUtilization;
    private double congestionRisk;
    private double confidence;
    @Column(length = 80)
    private String predictionSource;
    @Column(length = 40)
    private String predictionRunId;
    @Column(length = 4000)
    private String factualExplanation;
    @Column(length = 8000)
    private String predictionFactorsJson;
    @Column(length = 4000)
    private String predictionCounterfactualsJson;

    // ---- twin + scoring outcome
    @Column(length = 20000)
    private String baselineKpiJson;
    @Column(length = 4000)
    private String classDemandJson;
    @Column(length = 1000)
    private String weightsJson;
    private Long selectedCandidateId;
    private Long alternativeCandidateId;
    @Column(length = 4000)
    private String whySelected;
    @Column(length = 4000)
    private String whyNotAlternative;
    @Column(length = 4000)
    private String counterfactual;
    @Column(length = 4000)
    private String humanImpact;

    // ---- decision
    @Column(length = 30)
    private String approvalMode;
    @Column(length = 1000)
    private String autoApprovalNote;
    private Instant expiresAt;
    @Column(length = 100)
    private String decidedBy;
    private Instant decidedAt;
    @Column(length = 1000)
    private String decisionComment;
    private Long approvedCandidateId;

    // ---- enforcement
    private Long enforcementId;
    @Column(length = 2000)
    private String failureReason;
}
