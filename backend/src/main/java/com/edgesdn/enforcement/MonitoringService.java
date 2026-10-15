package com.edgesdn.enforcement;

import com.edgesdn.audit.AuditService;
import com.edgesdn.audit.AuditType;
import com.edgesdn.common.JsonCodec;
import com.edgesdn.config.EdgeProperties;
import com.edgesdn.enforcement.LiveKpiCollector.LiveKpi;
import com.edgesdn.policy.PolicyConfig;
import com.edgesdn.policy.PolicyService;
import com.edgesdn.topology.TopologyIndex;
import com.edgesdn.topology.TopologyService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Post-enforcement watchdog. Every sample compares live KPIs with the baseline captured just before
 * the change; N consecutive regressions trigger automatic rollback. After the monitoring window
 * without rollback, the action is VERIFIED and kept.
 * <pre>
 * regression if any of:
 *   maxLinkUtil  > baseline * (1 + rollbackUtilIncreasePct/100)    and +5 pp absolute
 *   avgLatency   > baseline * (1 + rollbackLatencyIncreasePct/100) and +5 ms absolute
 *   probeLoss    > rollbackLossPct                                 and +1 pp above baseline
 * </pre>
 */
@Service
public class MonitoringService {

    private static final Logger log = LoggerFactory.getLogger(MonitoringService.class);

    private final EnforcementRepository repo;
    private final EnforcementService enforcement;
    private final LiveKpiCollector liveKpi;
    private final TopologyService topology;
    private final PolicyService policies;
    private final AuditService audit;
    private final JsonCodec json;
    private final EdgeProperties props;

    public MonitoringService(EnforcementRepository repo, EnforcementService enforcement, LiveKpiCollector liveKpi,
                             TopologyService topology, PolicyService policies, AuditService audit, JsonCodec json,
                             EdgeProperties props) {
        this.repo = repo;
        this.enforcement = enforcement;
        this.liveKpi = liveKpi;
        this.topology = topology;
        this.policies = policies;
        this.audit = audit;
        this.json = json;
        this.props = props;
    }

    @Scheduled(fixedDelayString = "${edge.monitoring.sample-interval-ms:15000}", initialDelay = 20000)
    public void tick() {
        List<Enforcement> monitoring = repo.findByStatus(EnforcementStatus.MONITORING);
        if (monitoring.isEmpty()) {
            return;
        }
        Optional<TopologyIndex> t = topology.current();
        if (t.isEmpty()) {
            return;
        }
        PolicyConfig p = policies.get();
        for (Enforcement e : monitoring) {
            try {
                evaluate(t.get(), e, p);
            } catch (Exception ex) {
                log.warn("Monitoring of enforcement {} failed: {}", e.getId(), ex.getMessage());
            }
        }
    }

    private void evaluate(TopologyIndex t, Enforcement e, PolicyConfig p) {
        LiveKpi base = json.read(e.getBaselineKpiJson(), LiveKpi.class);
        LiveKpi cur = liveKpi.collect(t, e.getTargetLinkId(), EnforcementService.limitedClasses(e));
        List<String> reasons = base == null ? new ArrayList<>() : regressions(base, cur, p);
        if (e.isRegressionInjected()) {
            reasons.add("DEMO: synthetic regression injected by administrator (not a measured KPI change)");
        }
        e.setSamplesTaken(e.getSamplesTaken() + 1);
        e.setLastKpiJson(JsonCodec.truncate(json.write(cur), 4000));
        if (reasons.isEmpty()) {
            e.setConsecutiveRegressions(0);
        } else {
            e.setConsecutiveRegressions(e.getConsecutiveRegressions() + 1);
            e.setLastRegression(JsonCodec.truncate(String.join("; ", reasons), 2000));
        }
        repo.save(e);

        int needed = Math.max(1, props.getMonitoring().getConsecutiveRegressions());
        if (e.getConsecutiveRegressions() >= needed) {
            audit.record(AuditType.REGRESSION_DETECTED, "SYSTEM:monitor", e.getRecommendationId(), e.getId(),
                    "KPI regression in " + needed + " consecutive samples: " + String.join("; ", reasons),
                    Map.of("baseline", base == null ? "n/a" : base, "current", cur));
            enforcement.rollback(e.getId(), EnforcementStatus.ROLLED_BACK,
                    "Automatic rollback: " + String.join("; ", reasons), "SYSTEM:monitor");
            return;
        }
        if (e.getMonitorUntil() != null && Instant.now().isAfter(e.getMonitorUntil())) {
            enforcement.markVerified(e.getId());
        }
    }

    static List<String> regressions(LiveKpi b, LiveKpi c, PolicyConfig p) {
        List<String> reasons = new ArrayList<>();
        if (b.maxLinkUtil() != null && c.maxLinkUtil() != null) {
            double limit = b.maxLinkUtil() * (1 + p.getRollbackUtilIncreasePct() / 100.0);
            if (c.maxLinkUtil() > limit && c.maxLinkUtil() - b.maxLinkUtil() > 0.05) {
                reasons.add(String.format("busiest-link utilisation rose %.0f%% -> %.0f%% (limit %.0f%%)",
                        b.maxLinkUtil() * 100, c.maxLinkUtil() * 100, limit * 100));
            }
        }
        if (b.avgLatencyMs() != null && c.avgLatencyMs() != null) {
            double limit = b.avgLatencyMs() * (1 + p.getRollbackLatencyIncreasePct() / 100.0);
            if (c.avgLatencyMs() > limit && c.avgLatencyMs() - b.avgLatencyMs() > 5.0) {
                reasons.add(String.format("average latency rose %.1f -> %.1f ms (limit %.1f ms)",
                        b.avgLatencyMs(), c.avgLatencyMs(), limit));
            }
        }
        if (c.avgProbeLossPct() != null && c.avgProbeLossPct() > p.getRollbackLossPct()) {
            double baseLoss = b.avgProbeLossPct() == null ? 0 : b.avgProbeLossPct();
            if (c.avgProbeLossPct() > baseLoss + 1.0) {
                reasons.add(String.format("probe loss %.1f%% exceeds %.1f%% (baseline %.1f%%)",
                        c.avgProbeLossPct(), p.getRollbackLossPct(), baseLoss));
            }
        }
        return reasons;
    }
}
