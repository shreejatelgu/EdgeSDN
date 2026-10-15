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

@Entity
@Table(name = "recommendation_candidate", indexes = {
        @Index(name = "idx_cand_rec", columnList = "recommendation_id")
})
@Getter
@Setter
@NoArgsConstructor
public class RecommendationCandidate {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "recommendation_id", nullable = false)
    private Long recommendationId;

    private int rankNo;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ActionType actionType;

    @Column(nullable = false, length = 40)
    private String trafficClass;

    @Column(length = 500)
    private String description;

    @Column(length = 1000)
    private String pathJson;

    @Column(length = 1000)
    private String baselinePathJson;

    private Long rateKbps;

    @Column(length = 20000)
    private String flowsJson;

    @Column(length = 2000)
    private String metersJson;

    @Column(length = 20000)
    private String twinKpiJson;

    private double rawImprovement;
    private double kpiImprovement;
    private double risk;
    private double confidence;
    private double score;

    @Column(length = 2000)
    private String improvementBreakdownJson;

    @Column(length = 2000)
    private String riskBreakdownJson;

    @Enumerated(EnumType.STRING)
    @Column(length = 30)
    private CandidateStatus status;

    @Column(length = 1000)
    private String note;
}
