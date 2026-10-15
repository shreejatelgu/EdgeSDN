package com.edgesdn.recommendation;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RecommendationCandidateRepository extends JpaRepository<RecommendationCandidate, Long> {

    List<RecommendationCandidate> findByRecommendationIdOrderByRankNoAsc(Long recommendationId);
}
