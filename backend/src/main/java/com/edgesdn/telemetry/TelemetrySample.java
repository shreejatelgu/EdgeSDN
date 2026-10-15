package com.edgesdn.telemetry;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * One normalised telemetry measurement.
 * subjectType LINK: subjectId = link id, utilization = max(direction) / capacity.
 * subjectType GROUP: subjectId = host group, mbps = traffic delivered to the group's hosts.
 */
@Entity
@Table(name = "telemetry_sample", indexes = {
        @Index(name = "idx_tel_subject_ts", columnList = "subject_type,subject_id,ts"),
        @Index(name = "idx_tel_ts", columnList = "ts")
})
@Getter
@Setter
@NoArgsConstructor
public class TelemetrySample {

    public static final String LINK = "LINK";
    public static final String GROUP = "GROUP";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "subject_type", nullable = false, length = 10)
    private String subjectType;

    @Column(name = "subject_id", nullable = false, length = 64)
    private String subjectId;

    @Column(name = "ts", nullable = false)
    private Instant ts;

    private double mbps;

    private double utilization;

    public TelemetrySample(String subjectType, String subjectId, Instant ts, double mbps, double utilization) {
        this.subjectType = subjectType;
        this.subjectId = subjectId;
        this.ts = ts;
        this.mbps = mbps;
        this.utilization = utilization;
    }
}
