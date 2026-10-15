package com.edgesdn.enforcement;

import com.edgesdn.audit.AuditService;
import com.edgesdn.audit.AuditType;
import com.edgesdn.common.Exceptions.ConflictException;
import com.edgesdn.common.Exceptions.NotFoundException;
import com.edgesdn.common.JsonCodec;
import com.edgesdn.enforcement.LiveKpiCollector.LiveKpi;
import com.edgesdn.policy.PolicyService;
import com.edgesdn.recommendation.ActionType;
import com.edgesdn.recommendation.Recommendation;
import com.edgesdn.recommendation.RecommendationCandidate;
import com.edgesdn.recommendation.RecommendationRepository;
import com.edgesdn.recommendation.RecommendationStatus;
import com.edgesdn.routing.FlowSpec;
import com.edgesdn.routing.MeterSpec;
import com.edgesdn.sdn.SdnControllerClient;
import com.edgesdn.topology.TopologyIndex;
import com.edgesdn.topology.TopologyService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Enforcement through the SDN controller, with a pre-change snapshot, baseline KPI capture and
 * rollback. Every EDGE-SDN action only ADDS higher-priority rules (and meters) on top of the baseline,
 * so rollback = delete exactly those rules and meters; the baseline then applies again.
 */
@Service
public class EnforcementService {

    private static final Logger log = LoggerFactory.getLogger(EnforcementService.class);

    private final EnforcementRepository repo;
    private final RecommendationRepository recs;
    private final SdnControllerClient controller;
    private final TopologyService topology;
    private final LiveKpiCollector liveKpi;
    private final PolicyService policies;
    private final AuditService audit;
    private final JsonCodec json;

    public EnforcementService(EnforcementRepository repo, RecommendationRepository recs,
                              SdnControllerClient controller, TopologyService topology, LiveKpiCollector liveKpi,
                              PolicyService policies, AuditService audit, JsonCodec json) {
        this.repo = repo;
        this.recs = recs;
        this.controller = controller;
        this.topology = topology;
        this.liveKpi = liveKpi;
        this.policies = policies;
        this.audit = audit;
        this.json = json;
    }

    /** Enforcements left in APPLYING by a crash cannot be trusted: mark them FAILED on startup. */
    @EventListener(ApplicationReadyEvent.class)
    public void recoverInterrupted() {
        for (Enforcement e : repo.findByStatus(EnforcementStatus.APPLYING)) {
            e.setStatus(EnforcementStatus.FAILED);
            e.setEndedAt(Instant.now());
            e.setEndReason("Interrupted by backend restart while applying; re-initialise the network to clear rules");
            repo.save(e);
            updateRec(e.getRecommendationId(), RecommendationStatus.FAILED, e.getId(), e.getEndReason());
        }
    }

    public List<Enforcement> list() {
        return repo.findTop100ByOrderByIdDesc();
    }

    public Enforcement get(long id) {
        return repo.findById(id).orElseThrow(() -> new NotFoundException("Enforcement " + id + " not found"));
    }

    public List<Enforcement> active() {
        return repo.findByStatusIn(EnforcementStatus.ACTIVE);
    }

    /** Throws ConflictException if the candidate cannot be applied now. */
    public void assertCanApply(RecommendationCandidate c) {
        if (repo.existsByStatusIn(EnforcementStatus.IN_PROGRESS)) {
            throw new ConflictException("Another action is being applied or monitored; wait until it is verified or rolled back");
        }
        if (repo.existsByTrafficClassAndStatusIn(c.getTrafficClass(), EnforcementStatus.ACTIVE)) {
            throw new ConflictException("Traffic class " + c.getTrafficClass()
                    + " already has an active action; revert it first");
        }
    }

    public synchronized Enforcement apply(Recommendation rec, RecommendationCandidate cand, String actor) {
        TopologyIndex t = topology.require();
        assertCanApply(cand);
        List<FlowSpec> flows = json.readList(cand.getFlowsJson(), JsonCodec.FLOW_LIST);
        List<MeterSpec> meters = json.readList(cand.getMetersJson(), JsonCodec.METER_LIST);

        Enforcement e = new Enforcement();
        e.setRecommendationId(rec.getId());
        e.setCandidateId(cand.getId());
        e.setTrafficClass(cand.getTrafficClass());
        e.setActionType(cand.getActionType());
        e.setTargetLinkId(rec.getTargetLinkId());
        e.setPathJson(cand.getPathJson());
        e.setFlowsJson(cand.getFlowsJson());
        e.setMetersJson(cand.getMetersJson());
        e.setStatus(EnforcementStatus.APPLYING);
        e.setStartedAt(Instant.now());
        e.setAppliedBy(actor);
        e = repo.save(e);
        updateRec(rec.getId(), RecommendationStatus.APPLYING, e.getId(), null);

        // 1. snapshot of the configured action table on every touched switch
        Set<String> switches = new LinkedHashSet<>();
        flows.forEach(f -> switches.add(f.switchName()));
        meters.forEach(m -> switches.add(m.switchName()));
        Map<String, String> snapshot = new LinkedHashMap<>();
        for (String sw : switches) {
            try {
                snapshot.put(sw, controller.readTableConfig(t, sw, 0));
            } catch (Exception ex) {
                snapshot.put(sw, "unavailable: " + ex.getMessage());
            }
        }
        e.setPreSnapshotJson(JsonCodec.truncate(json.write(snapshot), 60000));

        // 2. baseline KPIs of the live network, used by the rollback monitor
        LiveKpi baseline = liveKpi.collect(t, rec.getTargetLinkId(), limitedClasses(e));
        e.setBaselineKpiJson(JsonCodec.truncate(json.write(baseline), 4000));
        e = repo.save(e);

        // 3. install meters first (flows reference them), then flows
        List<MeterSpec> installedMeters = new ArrayList<>();
        List<FlowSpec> installedFlows = new ArrayList<>();
        try {
            for (MeterSpec m : meters) {
                controller.installMeter(t, m);
                installedMeters.add(m);
            }
            for (FlowSpec f : flows) {
                controller.installFlow(t, f);
                installedFlows.add(f);
            }
        } catch (Exception ex) {
            List<String> cleanup = removeAll(t, installedFlows, installedMeters);
            e.setStatus(EnforcementStatus.FAILED);
            e.setEndedAt(Instant.now());
            e.setEndReason(JsonCodec.truncate("Controller rejected the action: " + ex.getMessage()
                    + (cleanup.isEmpty() ? "" : " | cleanup warnings: " + cleanup), 2000));
            repo.save(e);
            updateRec(rec.getId(), RecommendationStatus.FAILED, e.getId(), e.getEndReason());
            audit.record(AuditType.ENFORCEMENT_FAILED, actor, rec.getId(), e.getId(), e.getEndReason(), null);
            return e;
        }

        e.setStatus(EnforcementStatus.MONITORING);
        e.setMonitorUntil(Instant.now().plus(Duration.ofSeconds(policies.get().getMonitorWindowSec())));
        e = repo.save(e);
        updateRec(rec.getId(), RecommendationStatus.MONITORING, e.getId(), null);
        audit.record(AuditType.ENFORCEMENT_APPLIED, actor, rec.getId(), e.getId(),
                String.format("Applied %s for %s via SDN controller (%d rules, %d meters); monitoring until %s",
                        e.getActionType(), e.getTrafficClass(), flows.size(), meters.size(), e.getMonitorUntil()),
                Map.of("switches", switches, "baselineKpi", baseline));
        return e;
    }

    public synchronized Enforcement rollback(long id, EnforcementStatus finalStatus, String reason, String actor) {
        if (finalStatus != EnforcementStatus.ROLLED_BACK && finalStatus != EnforcementStatus.REVERTED) {
            throw new IllegalArgumentException("finalStatus must be ROLLED_BACK or REVERTED");
        }
        Enforcement e = get(id);
        if (!EnforcementStatus.ACTIVE.contains(e.getStatus())) {
            throw new ConflictException("Enforcement " + id + " is " + e.getStatus() + " and has no active rules");
        }
        TopologyIndex t = topology.require();
        List<String> warnings = removeAll(t,
                json.readList(e.getFlowsJson(), JsonCodec.FLOW_LIST),
                json.readList(e.getMetersJson(), JsonCodec.METER_LIST));
        e.setStatus(finalStatus);
        e.setEndedAt(Instant.now());
        e.setEndReason(JsonCodec.truncate(reason + (warnings.isEmpty() ? "" : " | warnings: " + warnings), 2000));
        e = repo.save(e);
        RecommendationStatus rs = finalStatus == EnforcementStatus.ROLLED_BACK
                ? RecommendationStatus.ROLLED_BACK : RecommendationStatus.REVERTED;
        updateRec(e.getRecommendationId(), rs, e.getId(), null);
        audit.record(finalStatus == EnforcementStatus.ROLLED_BACK ? AuditType.ROLLED_BACK : AuditType.REVERTED,
                actor, e.getRecommendationId(), e.getId(), e.getEndReason(), null);
        return e;
    }

    public synchronized Enforcement markVerified(long id) {
        Enforcement e = get(id);
        if (e.getStatus() != EnforcementStatus.MONITORING) {
            return e;
        }
        e.setStatus(EnforcementStatus.VERIFIED);
        e = repo.save(e);
        updateRec(e.getRecommendationId(), RecommendationStatus.VERIFIED, e.getId(), null);
        audit.record(AuditType.VERIFIED, "SYSTEM:monitor", e.getRecommendationId(), e.getId(),
                "No significant KPI regression during the monitoring window (" + e.getSamplesTaken()
                        + " samples); action kept", e.getLastKpiJson());
        return e;
    }

    public synchronized Enforcement injectRegression(long id, String actor) {
        Enforcement e = get(id);
        if (e.getStatus() != EnforcementStatus.MONITORING) {
            throw new ConflictException("Regression can only be injected while the enforcement is MONITORING");
        }
        e.setRegressionInjected(true);
        e = repo.save(e);
        audit.record(AuditType.DEMO_REGRESSION_INJECTED, actor, e.getRecommendationId(), e.getId(),
                "DEMO: administrator injected a synthetic regression to demonstrate automatic rollback", null);
        return e;
    }

    /**
     * Called before the network is re-initialised (tables are replaced wholesale): meters of active
     * enforcements are removed and the enforcements are marked REVERTED.
     */
    public synchronized void resetForReinit(TopologyIndex t, String actor) {
        for (Enforcement e : repo.findByStatusIn(EnforcementStatus.ACTIVE)) {
            List<String> warnings = removeAll(t, List.of(), json.readList(e.getMetersJson(), JsonCodec.METER_LIST));
            e.setStatus(EnforcementStatus.REVERTED);
            e.setEndedAt(Instant.now());
            e.setEndReason("Network re-initialised: controller tables reset to baseline"
                    + (warnings.isEmpty() ? "" : " | warnings: " + warnings));
            repo.save(e);
            updateRec(e.getRecommendationId(), RecommendationStatus.REVERTED, e.getId(), null);
            audit.record(AuditType.REVERTED, actor, e.getRecommendationId(), e.getId(), e.getEndReason(), null);
        }
    }

    public static Set<String> limitedClasses(Enforcement e) {
        return e.getActionType() == ActionType.RATE_LIMIT && e.getTrafficClass() != null
                ? Set.of(e.getTrafficClass()) : Set.of();
    }

    /** Best effort: tries every removal and returns the failures. */
    private List<String> removeAll(TopologyIndex t, List<FlowSpec> flows, List<MeterSpec> meters) {
        List<String> warnings = new ArrayList<>();
        for (FlowSpec f : flows) {
            try {
                controller.removeFlow(t, f.switchName(), f.table(), f.id());
            } catch (Exception ex) {
                warnings.add("flow " + f.id() + ": " + ex.getMessage());
                log.warn("Rollback: could not remove flow {}: {}", f.id(), ex.getMessage());
            }
        }
        for (MeterSpec m : meters) {
            try {
                controller.removeMeter(t, m.switchName(), m.meterId());
            } catch (Exception ex) {
                warnings.add("meter " + m.meterId() + ": " + ex.getMessage());
                log.warn("Rollback: could not remove meter {}: {}", m.meterId(), ex.getMessage());
            }
        }
        return warnings;
    }

    private void updateRec(Long recId, RecommendationStatus status, Long enfId, String failure) {
        if (recId == null) {
            return;
        }
        recs.findById(recId).ifPresent(r -> {
            r.setStatus(status);
            r.setUpdatedAt(Instant.now());
            if (enfId != null) {
                r.setEnforcementId(enfId);
            }
            if (failure != null) {
                r.setFailureReason(JsonCodec.truncate(failure, 2000));
            }
            recs.save(r);
        });
    }
}
