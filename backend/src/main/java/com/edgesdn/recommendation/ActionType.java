package com.edgesdn.recommendation;

/** Remediation actions supported by the prototype. Neither action disables any switch or link. */
public enum ActionType {
    /** Move a traffic class to an alternate path that avoids the congested link. */
    REROUTE,
    /** Cap a (non-HIGH priority) traffic class with an OpenFlow meter at the server access switch. */
    RATE_LIMIT
}
