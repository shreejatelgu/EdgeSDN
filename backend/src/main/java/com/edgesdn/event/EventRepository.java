package com.edgesdn.event;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

public interface EventRepository extends JpaRepository<InstitutionalEvent, Long> {

    List<InstitutionalEvent> findAllByOrderByStartTimeDesc();

    @Query("select e from InstitutionalEvent e where e.startTime < :to and e.endTime > :from order by e.startTime")
    List<InstitutionalEvent> findOverlapping(@Param("from") Instant from, @Param("to") Instant to);
}
