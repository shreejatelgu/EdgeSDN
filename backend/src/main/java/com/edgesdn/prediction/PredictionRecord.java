package com.edgesdn.prediction;

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

/** Persisted forecast (history for the UI, and ground-truth comparison data for later ML evaluation). */
@Entity
@Table(name = "prediction_record", indexes = {
        @Index(name = "idx_pred_link_ts", columnList = "link_id,generated_at"),
        @Index(name = "idx_pred_run", columnList = "run_id")
})
@Getter
@Setter
@NoArgsConstructor
public class PredictionRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "run_id", nullable = false, length = 40)
    private String runId;

    @Column(name = "generated_at", nullable = false)
    private Instant generatedAt;

    @Column(name = "link_id", nullable = false, length = 64)
    private String linkId;

    private int horizonMinutes;
    private double predictedUtilization;
    private double lowerBound;
    private double upperBound;
    private double congestionRisk;
    private double confidence;

    @Column(length = 60)
    private String source;

    @Column(length = 60)
    private String modelVersion;

    @Column(length = 8000)
    private String factorsJson;

    @Column(length = 4000)
    private String counterfactualsJson;
}
