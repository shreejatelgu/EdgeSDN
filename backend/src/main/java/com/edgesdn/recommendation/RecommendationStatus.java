package com.edgesdn.recommendation;

import java.util.EnumSet;
import java.util.Set;

public enum RecommendationStatus {
    SIMULATING,
    PENDING_APPROVAL,
    APPROVED,
    AUTO_APPROVED,
    REJECTED,
    EXPIRED,
    NO_ACTION_RECOMMENDED,
    APPLYING,
    MONITORING,
    VERIFIED,
    ROLLED_BACK,
    REVERTED,
    FAILED;

    /** Statuses in which the recommendation is still "in flight" for its link. */
    public static final Set<RecommendationStatus> OPEN =
            EnumSet.of(SIMULATING, PENDING_APPROVAL, APPROVED, AUTO_APPROVED, APPLYING, MONITORING);
}
