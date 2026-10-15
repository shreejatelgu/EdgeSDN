package com.edgesdn.recommendation;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

public interface RecommendationRepository extends JpaRepository<Recommendation, Long> {

    boolean existsByStatusIn(Collection<RecommendationStatus> statuses);

    boolean existsByTargetLinkIdAndStatusIn(String targetLinkId, Collection<RecommendationStatus> statuses);

    List<Recommendation> findByStatusIn(Collection<RecommendationStatus> statuses);

    List<Recommendation> findTop100ByOrderByIdDesc();

    List<Recommendation> findTop100ByStatusOrderByIdDesc(RecommendationStatus status);

    List<Recommendation> findByStatusAndExpiresAtBefore(RecommendationStatus status, Instant before);

    long countByDecidedByAndDecidedAtAfter(String decidedBy, Instant after);
}
