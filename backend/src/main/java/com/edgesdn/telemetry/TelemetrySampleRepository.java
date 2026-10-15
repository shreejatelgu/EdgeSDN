package com.edgesdn.telemetry;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

public interface TelemetrySampleRepository extends JpaRepository<TelemetrySample, Long> {

    List<TelemetrySample> findBySubjectTypeAndSubjectIdAndTsAfterOrderByTsAsc(String subjectType, String subjectId,
                                                                              Instant after);

    List<TelemetrySample> findByTsBetweenOrderByTsAsc(Instant from, Instant to);

    @Modifying
    @Transactional
    @Query("delete from TelemetrySample t where t.ts < :before")
    int deleteOlderThan(@Param("before") Instant before);
}
