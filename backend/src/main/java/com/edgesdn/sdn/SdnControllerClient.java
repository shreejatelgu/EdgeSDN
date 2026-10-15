package com.edgesdn.sdn;

import com.edgesdn.agent.AgentModels.PortCounters;
import com.edgesdn.routing.FlowSpec;
import com.edgesdn.routing.MeterSpec;
import com.edgesdn.topology.TopologyIndex;

import java.util.List;
import java.util.Map;

/**
 * Controller abstraction. EDGE-SDN sits above the controller and only uses these operations,
 * so replacing OpenDaylight (e.g. with ONOS) means writing one new implementation of this interface.
 */
public interface SdnControllerClient {

    record ControllerStatus(boolean reachable, int connectedSwitches, String message) {
    }

    void installFlow(TopologyIndex t, FlowSpec flow);

    /** Idempotent: removing a flow that does not exist is not an error. */
    void removeFlow(TopologyIndex t, String switchName, int table, String flowId);

    void installMeter(TopologyIndex t, MeterSpec meter);

    /** Idempotent. */
    void removeMeter(TopologyIndex t, String switchName, long meterId);

    /** Replaces the whole configured content of a table on one switch. */
    void replaceTable(TopologyIndex t, String switchName, int table, List<FlowSpec> flows);

    /** Raw JSON of the configured table (used as the pre-enforcement snapshot). */
    String readTableConfig(TopologyIndex t, String switchName, int table);

    /** switch name -> port number -> byte counters. */
    Map<String, Map<Integer, PortCounters>> fetchPortStats(TopologyIndex t);

    ControllerStatus status();
}
