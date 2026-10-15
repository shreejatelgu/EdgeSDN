package com.edgesdn.routing;

/**
 * Controller-neutral flow description. It is translated to OpenDaylight RESTCONF JSON for the live
 * network and to ovs-ofctl syntax by the twin-agent for the digital twin, so both receive the same rules.
 * Instruction order: meter (optional) -> output (optional) -> goto-table (optional).
 */
public record FlowSpec(String id, String switchName, int table, int priority, FlowMatch match,
                       Integer outputPort, Integer gotoTable, Long meterId) {
}
