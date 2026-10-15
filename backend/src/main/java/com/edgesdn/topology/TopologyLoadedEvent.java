package com.edgesdn.topology;

public record TopologyLoadedEvent(TopologyIndex index, boolean firstLoad) {
}
