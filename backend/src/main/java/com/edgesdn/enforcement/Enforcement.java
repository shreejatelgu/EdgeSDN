package com.edgesdn.enforcement;

import com.edgesdn.recommendation.ActionType;
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
@Table(name = "enforcement", indexes = {
        @Index(name = "idx_enf_status", columnList = "status")
})
@Getter
@Setter
@NoArgsConstructor
public class Enforcement {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long recommendationId;
    private Long candidateId;

    @Column(length = 40)
    private String trafficClass;

    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private ActionType actionType;

    @Column(length = 64)
    private String targetLinkId;

    @Column(length = 1000)
    private String pathJson;

    @Column(length = 20000)
    private String flowsJson;

    @Column(length = 2000)
    private String metersJson;

    /** Configured table-0 content of every touched switch before the change (JSON, possibly truncated). */
    @Column(length = 60000)
    private String preSnapshotJson;

    @Column(length = 4000)
    private String baselineKpiJson;

    @Column(length = 4000)
    private String lastKpiJson;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 20)
    private EnforcementStatus status;

    private Instant startedAt;
    private Instant monitorUntil;
    private Instant endedAt;

    @Column(length = 2000)
    private String endReason;

    @Column(length = 100)
    private String appliedBy;

    private int samplesTaken;
    private int consecutiveRegressions;

    @Column(length = 2000)
    private String lastRegression;

    /** Demo only: when true the monitor treats every sample as a regression (labelled as injected). */
    private boolean regressionInjected;
}
