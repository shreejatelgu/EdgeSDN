package com.edgesdn.telemetry;

import com.edgesdn.agent.AgentClient;
import com.edgesdn.agent.AgentModels.PortCounters;
import com.edgesdn.config.EdgeProperties;
import com.edgesdn.sdn.SdnControllerClient;
import com.edgesdn.topology.TopologyIndex;
import com.edgesdn.topology.TopologyModels.HostGroup;
import com.edgesdn.topology.TopologyModels.HostNode;
import com.edgesdn.topology.TopologyModels.LinkInfo;
import com.edgesdn.topology.TopologyService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Layer 1 - telemetry ingestion. Polls byte counters (OpenDaylight port statistics or the agent's
 * interface counters), converts deltas to Mbps/utilisation and stores normalised samples.
 */
@Service
public class TelemetryService {

    private static final Logger log = LoggerFactory.getLogger(TelemetryService.class);

    public record LinkUtil(String linkId, double mbps, double utilization, double capacityMbps) {
    }

    public record GroupDemand(String group, double mbps, double utilization) {
    }

    public record TelemetrySnapshot(Instant polledAt, String source, String lastError, boolean stale,
                                    List<LinkUtil> links, List<GroupDemand> groups) {
    }

    private final TopologyService topology;
    private final SdnControllerClient controller;
    private final AgentClient agent;
    private final TelemetrySampleRepository repo;
    private final EdgeProperties props;

    private Map<String, Map<Integer, PortCounters>> prevCounters;
    private Instant prevAt;
    private volatile Map<String, LinkUtil> latestLinks = Map.of();
    private volatile Map<String, GroupDemand> latestGroups = Map.of();
    private volatile Instant lastPollAt;
    private volatile String lastError = "no poll yet";

    public TelemetryService(TopologyService topology, SdnControllerClient controller, AgentClient agent,
                            TelemetrySampleRepository repo, EdgeProperties props) {
        this.topology = topology;
        this.controller = controller;
        this.agent = agent;
        this.repo = repo;
        this.props = props;
    }

    @Scheduled(fixedDelayString = "${edge.telemetry.poll-interval-ms:10000}", initialDelay = 5000)
    public void poll() {
        Optional<TopologyIndex> opt = topology.current();
        if (opt.isEmpty()) {
            lastError = "topology not loaded";
            return;
        }
        TopologyIndex t = opt.get();
        Map<String, Map<Integer, PortCounters>> counters;
        try {
            counters = props.getTelemetry().getSource() == EdgeProperties.TelemetrySource.AGENT
                    ? agent.livePortStats()
                    : controller.fetchPortStats(t);
        } catch (Exception e) {
            lastError = e.getMessage();
            log.debug("Telemetry poll failed: {}", e.getMessage());
            return;
        }
        Instant now = Instant.now();
        if (prevCounters != null && prevAt != null) {
            double dt = Duration.between(prevAt, now).toMillis() / 1000.0;
            if (dt >= 1.0) {
                compute(t, counters, dt, now);
            }
        }
        prevCounters = counters;
        prevAt = now;
        lastError = null;
    }

    private void compute(TopologyIndex t, Map<String, Map<Integer, PortCounters>> cur, double dt, Instant now) {
        List<TelemetrySample> batch = new ArrayList<>();
        Map<String, LinkUtil> links = new LinkedHashMap<>();
        for (LinkInfo l : t.links()) {
            Long dA = txDelta(cur, prevCounters, l.a(), l.aPort());
            Long dB = txDelta(cur, prevCounters, l.b(), l.bPort());
            if (dA == null && dB == null) {
                continue;
            }
            long d = Math.max(dA == null ? 0 : dA, dB == null ? 0 : dB);
            double mbps = d * 8.0 / dt / 1_000_000.0;
            double util = l.capacityMbps() > 0 ? mbps / l.capacityMbps() : 0.0;
            links.put(l.id(), new LinkUtil(l.id(), mbps, util, l.capacityMbps()));
            batch.add(new TelemetrySample(TelemetrySample.LINK, l.id(), now, mbps, util));
        }
        Map<String, GroupDemand> groups = new LinkedHashMap<>();
        for (HostGroup g : t.groups()) {
            if (g.server()) {
                continue;
            }
            long sum = 0;
            boolean any = false;
            for (HostNode h : t.hostsOf(g)) {
                Long d = txDelta(cur, prevCounters, h.switchName(), h.port());
                if (d != null) {
                    sum += d;
                    any = true;
                }
            }
            if (!any) {
                continue;
            }
            double mbps = sum * 8.0 / dt / 1_000_000.0;
            double cap = t.uplinkCapacity(g.accessSwitch());
            double util = cap > 0 ? mbps / cap : 0.0;
            groups.put(g.name(), new GroupDemand(g.name(), mbps, util));
            batch.add(new TelemetrySample(TelemetrySample.GROUP, g.name(), now, mbps, util));
        }
        if (!batch.isEmpty()) {
            repo.saveAll(batch);
        }
        latestLinks = Map.copyOf(links);
        latestGroups = Map.copyOf(groups);
        lastPollAt = now;
    }

    /** Transmitted-bytes delta, or null when unavailable or the counter was reset. */
    private static Long txDelta(Map<String, Map<Integer, PortCounters>> cur,
                                Map<String, Map<Integer, PortCounters>> prev, String sw, int port) {
        PortCounters c = cur.getOrDefault(sw, Map.of()).get(port);
        PortCounters p = prev.getOrDefault(sw, Map.of()).get(port);
        if (c == null || p == null) {
            return null;
        }
        long d = c.txBytes() - p.txBytes();
        return d < 0 ? null : d;
    }

    @Scheduled(cron = "0 17 * * * *")
    public void cleanup() {
        int removed = repo.deleteOlderThan(Instant.now().minus(Duration.ofHours(props.getTelemetry().getRetentionHours())));
        if (removed > 0) {
            log.info("Telemetry retention: removed {} samples", removed);
        }
    }

    public List<TelemetrySample> history(String subjectType, String subjectId, int minutes) {
        return repo.findBySubjectTypeAndSubjectIdAndTsAfterOrderByTsAsc(subjectType, subjectId,
                Instant.now().minus(Duration.ofMinutes(Math.max(1, Math.min(minutes, 60 * 24 * 7)))));
    }

    public TelemetrySnapshot latest() {
        return new TelemetrySnapshot(lastPollAt, props.getTelemetry().getSource().name(), lastError, isStale(),
                List.copyOf(latestLinks.values()), List.copyOf(latestGroups.values()));
    }

    public boolean isStale() {
        Instant at = lastPollAt;
        long maxAgeMs = Math.max(30_000, props.getTelemetry().getPollIntervalMs() * 3);
        return at == null || Duration.between(at, Instant.now()).toMillis() > maxAgeMs;
    }

    public Map<String, Double> latestLinkUtilization() {
        Map<String, Double> m = new LinkedHashMap<>();
        latestLinks.forEach((k, v) -> m.put(k, v.utilization()));
        return m;
    }

    public Map<String, Double> latestGroupDemandMbps() {
        Map<String, Double> m = new LinkedHashMap<>();
        latestGroups.forEach((k, v) -> m.put(k, v.mbps()));
        return m;
    }
}
