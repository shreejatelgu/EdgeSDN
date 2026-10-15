package com.edgesdn.recommendation;

public enum CandidateStatus {
    /** Simulated successfully and improves KPIs by more than policy.minImprovement. */
    SELECTABLE,
    /** Simulated, but the twin showed no meaningful improvement (or a regression). */
    NO_GAIN,
    /** The twin could not simulate this candidate. It can never be approved. */
    SIMULATION_FAILED
}
