package com.edgesdn.audit;

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

/**
 * Append-only audit record. Each row stores the SHA-256 of its own content chained with the
 * previous row's hash, so any later modification of the log is detectable (GET /api/audit/verify).
 */
@Entity
@Table(name = "audit_event", indexes = {
        @Index(name = "idx_audit_ts", columnList = "ts"),
        @Index(name = "idx_audit_rec", columnList = "recommendation_id")
})
@Getter
@Setter
@NoArgsConstructor
public class AuditEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "ts", nullable = false)
    private Instant ts;

    @Column(nullable = false, length = 100)
    private String actor;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private AuditType type;

    @Column(name = "recommendation_id")
    private Long recommendationId;

    @Column(name = "enforcement_id")
    private Long enforcementId;

    @Column(length = 1000)
    private String summary;

    @Column(length = 20000)
    private String details;

    @Column(length = 64)
    private String prevHash;

    @Column(length = 64, nullable = false)
    private String hash;
}
