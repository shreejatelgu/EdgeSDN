package com.edgesdn.network;

import com.edgesdn.audit.AuditService;
import com.edgesdn.audit.AuditType;
import com.edgesdn.common.Exceptions.ExternalServiceException;
import com.edgesdn.config.EdgeProperties;
import com.edgesdn.enforcement.EnforcementService;
import com.edgesdn.routing.FlowSpec;
import com.edgesdn.routing.RoutingService;
import com.edgesdn.sdn.SdnControllerClient;
import com.edgesdn.topology.TopologyIndex;
import com.edgesdn.topology.TopologyLoadedEvent;
import com.edgesdn.topology.TopologyModels.SwitchNode;
import com.edgesdn.topology.TopologyService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Programs the baseline forwarding into OpenDaylight's config datastore:
 * table 1 = shortest-path /32 rules for every host, table 0 = a single "goto table 1" rule.
 * Replacing both tables also removes any stale EDGE-SDN action rules.
 */
@Service
public class NetworkInitService {

    private static final Logger log = LoggerFactory.getLogger(NetworkInitService.class);

    public record InitResult(Instant at, String actor, int switches, int flowsInstalled, List<String> errors) {
    }

    private final TopologyService topology;
    private final RoutingService routing;
    private final SdnControllerClient controller;
    private final EnforcementService enforcement;
    private final AuditService audit;
    private final EdgeProperties props;
    private volatile boolean autoInitDone;
    private volatile InitResult lastResult;

    public NetworkInitService(TopologyService topology, RoutingService routing, SdnControllerClient controller,
                              EnforcementService enforcement, AuditService audit, EdgeProperties props) {
        this.topology = topology;
        this.routing = routing;
        this.controller = controller;
        this.enforcement = enforcement;
        this.audit = audit;
        this.props = props;
    }

    @EventListener
    public void onTopologyLoaded(TopologyLoadedEvent event) {
        if (!props.getNetwork().isAutoInit() || autoInitDone) {
            return;
        }
        autoInitDone = true;
        try {
            initialize("SYSTEM:auto-init");
        } catch (Exception e) {
            log.warn("Automatic network initialisation failed (use POST /api/network/init): {}", e.getMessage());
        }
    }

    public synchronized InitResult initialize(String actor) {
        TopologyIndex t = topology.require();
        enforcement.resetForReinit(t, actor);
        Map<String, List<FlowSpec>> tables = routing.baselineTables(t);
        List<String> errors = new ArrayList<>();
        int flows = 0;
        for (SwitchNode s : t.switches()) {
            List<FlowSpec> baseline = tables.getOrDefault(s.name(), List.of());
            try {
                controller.replaceTable(t, s.name(), RoutingService.TABLE_BASELINE, baseline);
                controller.replaceTable(t, s.name(), RoutingService.TABLE_ACTIONS, List.of(routing.defaultGotoFlow(s.name())));
                flows += baseline.size() + 1;
            } catch (Exception e) {
                errors.add(s.name() + ": " + e.getMessage());
            }
        }
        InitResult result = new InitResult(Instant.now(), actor, t.switches().size(), flows, errors);
        lastResult = result;
        audit.record(AuditType.NETWORK_INITIALIZED, actor, null, null,
                String.format("Baseline forwarding programmed via SDN controller: %d rules on %d switches (%d errors)",
                        flows, t.switches().size(), errors.size()), errors);
        if (errors.size() == t.switches().size()) {
            throw new ExternalServiceException("Network initialisation failed on every switch: " + errors.get(0));
        }
        return result;
    }

    public InitResult lastResult() {
        return lastResult;
    }
}
