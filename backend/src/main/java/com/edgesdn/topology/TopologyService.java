package com.edgesdn.topology;

import com.edgesdn.agent.AgentClient;
import com.edgesdn.audit.AuditService;
import com.edgesdn.audit.AuditType;
import com.edgesdn.common.Exceptions.ExternalServiceException;
import com.edgesdn.topology.TopologyModels.Topology;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.Optional;

/** Loads the topology from the twin-agent and keeps it in memory; retries until the agent is up. */
@Service
public class TopologyService {

    private static final Logger log = LoggerFactory.getLogger(TopologyService.class);

    private final AgentClient agent;
    private final AuditService audit;
    private final ApplicationEventPublisher events;
    private volatile TopologyIndex index;
    private volatile String lastError = "not loaded yet";

    public TopologyService(AgentClient agent, AuditService audit, ApplicationEventPublisher events) {
        this.agent = agent;
        this.audit = audit;
        this.events = events;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        tryLoad();
    }

    @Scheduled(fixedDelay = 15000, initialDelay = 15000)
    public void retryIfMissing() {
        if (index == null) {
            tryLoad();
        }
    }

    public synchronized boolean tryLoad() {
        try {
            Topology t = agent.fetchTopology();
            TopologyIndex idx = new TopologyIndex(t);
            boolean first = index == null;
            index = idx;
            lastError = null;
            audit.system(AuditType.TOPOLOGY_LOADED,
                    "Topology loaded: " + t.switches().size() + " switches, " + t.links().size() + " links, "
                            + t.hosts().size() + " hosts",
                    Map.of("groups", t.groups().stream().map(TopologyModels.HostGroup::name).toList()));
            log.info("Topology loaded from twin-agent ({} switches, {} links)", t.switches().size(), t.links().size());
            events.publishEvent(new TopologyLoadedEvent(idx, first));
            return true;
        } catch (Exception e) {
            lastError = e.getMessage();
            log.warn("Topology not loaded: {}", e.getMessage());
            return false;
        }
    }

    public TopologyIndex require() {
        TopologyIndex idx = index;
        if (idx == null) {
            throw new ExternalServiceException("Topology not loaded (twin-agent unreachable?): " + lastError);
        }
        return idx;
    }

    public Optional<TopologyIndex> current() {
        return Optional.ofNullable(index);
    }

    public String lastError() {
        return lastError;
    }
}
