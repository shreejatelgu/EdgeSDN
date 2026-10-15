package com.edgesdn.prediction;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

public interface PredictionRecordRepository extends JpaRepository<PredictionRecord, Long> {

    List<PredictionRecord> findByLinkIdAndGeneratedAtAfterOrderByGeneratedAtAsc(String linkId, Instant after);

    @Modifying
    @Transactional
    @Query("delete from PredictionRecord p where p.generatedAt < :before")
    int deleteOlderThan(@Param("before") Instant before);
}
