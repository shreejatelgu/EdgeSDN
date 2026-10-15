package com.edgesdn.audit;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AuditRepository extends JpaRepository<AuditEvent, Long> {

    Optional<AuditEvent> findTopByOrderByIdDesc();

    Page<AuditEvent> findAllByOrderByIdDesc(Pageable pageable);

    Page<AuditEvent> findByTypeOrderByIdDesc(AuditType type, Pageable pageable);

    Page<AuditEvent> findByRecommendationIdOrderByIdDesc(Long recommendationId, Pageable pageable);

    Page<AuditEvent> findByTypeAndRecommendationIdOrderByIdDesc(AuditType type, Long recommendationId, Pageable pageable);

    List<AuditEvent> findAllByOrderByIdAsc();
}
