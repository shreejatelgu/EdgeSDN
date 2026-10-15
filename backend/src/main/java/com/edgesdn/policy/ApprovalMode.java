package com.edgesdn.policy;

public enum ApprovalMode {
    /** Every recommendation waits for an administrator decision. */
    MANUAL,
    /** Recommendations satisfying all auto-approval conditions are approved by policy; others wait. */
    AUTO_LOW_RISK
}
