package com.edgesdn.enforcement;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface EnforcementRepository extends JpaRepository<Enforcement, Long> {

    List<Enforcement> findByStatus(EnforcementStatus status);

    List<Enforcement> findByStatusIn(Collection<EnforcementStatus> statuses);

    boolean existsByStatusIn(Collection<EnforcementStatus> statuses);

    boolean existsByTrafficClassAndStatusIn(String trafficClass, Collection<EnforcementStatus> statuses);

    List<Enforcement> findTop100ByOrderByIdDesc();
}
