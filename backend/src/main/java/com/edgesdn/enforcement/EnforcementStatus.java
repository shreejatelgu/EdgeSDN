package com.edgesdn.enforcement;

import java.util.EnumSet;
import java.util.Set;

public enum EnforcementStatus {
    APPLYING,
    MONITORING,
    VERIFIED,
    ROLLED_BACK,
    REVERTED,
    FAILED;

    /** Rules of these enforcements are (or may be) installed in the live network. */
    public static final Set<EnforcementStatus> ACTIVE = EnumSet.of(APPLYING, MONITORING, VERIFIED);
    public static final Set<EnforcementStatus> IN_PROGRESS = EnumSet.of(APPLYING, MONITORING);
}
