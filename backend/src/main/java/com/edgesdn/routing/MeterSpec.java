package com.edgesdn.routing;

/** OpenFlow 1.3 drop meter (kbps). */
public record MeterSpec(String switchName, long meterId, long rateKbps, long burstKb) {
}
