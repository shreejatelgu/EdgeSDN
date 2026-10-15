package com.edgesdn.routing;

/** OpenFlow match fields used by EDGE-SDN. ipv4 fields are CIDR strings, e.g. "10.0.1.0/24". */
public record FlowMatch(Integer ethType, String ipv4Src, String ipv4Dst, Integer inPort) {

    public static FlowMatch any() {
        return new FlowMatch(null, null, null, null);
    }
}
