package com.edgesdn.recommendation;

import com.edgesdn.agent.AgentModels.ProbePair;
import com.edgesdn.agent.AgentModels.TrafficFlow;
import com.edgesdn.agent.AgentModels.TwinResult;
import com.edgesdn.audit.AuditService;
import com.edgesdn.audit.AuditType;
import com.edgesdn.common.JsonCodec;
import com.edgesdn.enforcement.Enforcement;
import com.edgesdn.enforcement.EnforcementRepository;
import com.edgesdn.enforcement.EnforcementStatus;
import com.edgesdn.policy.PolicyConfig;
import com.edgesdn.policy.PolicyService;
import com.edgesdn.prediction.PredictionModels.LinkForecast;
import com.edgesdn.recommendation.ScoringService.ScoreResult;
import com.edgesdn.routing.FlowSpec;
import com.edgesdn.routing.MeterSpec;
import com.edgesdn.telemetry.TelemetryService;
import com.edgesdn.topology.TopologyIndex;
import com.edgesdn.topology.TopologyModels.LinkInfo;
import com.edgesdn.topology.TopologyModels.TrafficClass;
import com.edgesdn.topology.TopologyService;
import com.edgesdn.twin.KpiCalculator;
import com.edgesdn.twin.KpiSummary;
import com.edgesdn.twin.TrafficProfileBuilder;
import com.edgesdn.twin.TwinService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The digital-twin-gated decision pipeline (runs asynchronously, one at a time):
 * <pre>
 * predicted demand -> candidates -> twin(baseline) + twin(each candidate) -> KPIs -> score -> rank
 *   -> select + alternative -> explanations + human impact -> PENDING_APPROVAL -> (auto-approval policy)
 * </pre>
 * A candidate that could not be simulated is never selectable.
 */
@Component
public class RecommendationPipeline {

    private static final Logger log = LoggerFactory.getLogger(RecommendationPipeline.class);

    private final RecommendationRepository recs;
    private final RecommendationCandidateRepository cands;
    private final TopologyService topology;
    private final TelemetryService telemetry;
    private final EnforcementRepository enforcements;
    private final CandidateGenerator generator;
    private final TrafficProfileBuilder traffic;
    private final TwinService twin;
    private final KpiCalculator kpi;
    private final ScoringService scoring;
    private final ExplanationService explanations;
    private final HumanImpactTranslator impact;
    private final ApprovalService approval;
    private final PolicyService policies;
    private final AuditService audit;
    private final JsonCodec json;

    public RecommendationPipeline(RecommendationRepository recs, RecommendationCandidateRepository cands,
                                  TopologyService topology, TelemetryService telemetry,
                                  EnforcementRepository enforcements, CandidateGenerator generator,
                                  TrafficProfileBuilder traffic, TwinService twin, KpiCalculator kpi,
                                  ScoringService scoring, ExplanationService explanations,
                                  HumanImpactTranslator impact, ApprovalService approval, PolicyService policies,
                                  AuditService audit, JsonCodec json) {
        this.recs = recs;
        this.cands = cands;
        this.topology = topology;
        this.telemetry = telemetry;
        this.enforcements = enforcements;
        this.generator = generator;
        this.traffic = traffic;
        this.twin = twin;
        this.kpi = kpi;
        this.scoring = scoring;
        this.explanations = explanations;
        this.impact = impact;
        this.approval = approval;
        this.policies = policies;
        this.audit = audit;
        this.json = json;
    }

    @Async("pipelineExecutor")
    public void run(long recId, LinkForecast forecast) {
        try {
            execute(recId, forecast);
        } catch (Exception e) {
            log.warn("Recommendation pipeline {} failed: {}", recId, e.getMessage(), e);
            recs.findById(recId).ifPresent(r -> {
                r.setStatus(RecommendationStatus.FAILED);
                r.setFailureReason(JsonCodec.truncate("Pipeline failed: " + e.getMessage(), 2000));
                r.setUpdatedAt(Instant.now());
                recs.save(r);
            });
            audit.record(AuditType.RECOMMENDATION_FAILED, "SYSTEM", recId, null,
                    "Pipeline failed: " + e.getMessage(), null);
        }
    }

    private void execute(long recId, LinkForecast f) {
        Recommendation r = recs.findById(recId).orElseThrow();
        PolicyConfig p = policies.get();
        TopologyIndex t = topology.require();
        LinkInfo target = t.link(r.getTargetLinkId());

        // ---- current network state: active actions and the resulting class paths
        List<Enforcement> active = enforcements.findByStatusIn(EnforcementStatus.ACTIVE);
        Map<String, List<String>> classPaths = new LinkedHashMap<>();
        for (TrafficClass c : t.trafficClasses()) {
            classPaths.put(c.id(), t.baselinePath(c));
        }
        Set<String> classesWithAction = new HashSet<>();
        List<FlowSpec> activeFlows = new ArrayList<>();
        List<MeterSpec> activeMeters = new ArrayList<>();
        for (Enforcement e : active) {
            classesWithAction.add(e.getTrafficClass());
            activeFlows.addAll(json.readList(e.getFlowsJson(), JsonCodec.FLOW_LIST));
            activeMeters.addAll(json.readList(e.getMetersJson(), JsonCodec.METER_LIST));
            if (e.getActionType() == ActionType.REROUTE) {
                List<String> path = json.readList(e.getPathJson(), JsonCodec.STRING_LIST);
                if (!path.isEmpty()) {
                    classPaths.put(e.getTrafficClass(), path);
                }
            }
        }

        // ---- predicted demand and candidates
        Map<String, Double> demand = traffic.predictedClassDemand(t, telemetry.latestGroupDemandMbps(), target,
                f.predictedUtilization(), classPaths);
        r.setClassDemandJson(json.write(demand));
        r.setWeightsJson(json.write(Map.of("improvement", p.getWeightImprovement(),
                "confidence", p.getWeightConfidence(), "risk", p.getWeightRisk())));
        r = recs.save(r);

        List<CandidateAction> actions = generator.generate(recId, t, target, classPaths, classesWithAction, demand, p);
        if (actions.isEmpty()) {
            finishNoAction(r, List.of(), p);
            return;
        }

        // ---- digital twin: baseline (current rules) + every candidate under identical predicted traffic
        List<TrafficFlow> flows = traffic.flows(t, demand);
        List<ProbePair> probes = traffic.probes(t);
        TwinResult baseRes = twin.simulate(t, activeFlows, activeMeters, List.of(), List.of(), flows, probes);
        KpiSummary baseKpi = kpi.summarize(baseRes, target.id(), Set.of());
        r.setBaselineKpiJson(JsonCodec.truncate(json.write(baseKpi), 20000));
        r = recs.save(r);
        audit.record(AuditType.TWIN_SIMULATED, "SYSTEM:twin", recId, null,
                String.format("Twin baseline: %s at %.0f%%, busiest link %.0f%%", target.id(),
                        pctOrZero(baseKpi.targetLinkUtil()), baseKpi.maxLinkUtil() * 100), baseKpi);

        List<Scored> scored = new ArrayList<>();
        for (CandidateAction a : actions) {
            RecommendationCandidate c = new RecommendationCandidate();
            c.setRecommendationId(recId);
            c.setActionType(a.type());
            c.setTrafficClass(a.trafficClass().id());
            c.setDescription(JsonCodec.truncate(a.description(), 500));
            c.setPathJson(json.write(a.path()));
            c.setBaselinePathJson(json.write(a.baselinePath()));
            c.setRateKbps(a.rateKbps());
            c.setFlowsJson(json.write(a.flows()));
            c.setMetersJson(json.write(a.meters()));
            c.setConfidence(f.confidence());
            Scored s;
            try {
                TwinResult res = twin.simulate(t, activeFlows, activeMeters, a.flows(), a.meters(), flows, probes);
                Set<String> limited = a.type() == ActionType.RATE_LIMIT ? Set.of(a.trafficClass().id()) : Set.of();
                KpiSummary ck = kpi.summarize(res, target.id(), limited);
                // Compare like with like: exclude the limited class from the baseline's protected KPIs too.
                KpiSummary bk = limited.isEmpty() ? baseKpi : kpi.summarize(baseRes, target.id(), limited);
                ScoreResult sr = scoring.score(t, a, bk, ck, f.confidence(), demand, p);
                c.setTwinKpiJson(JsonCodec.truncate(json.write(ck), 20000));
                c.setRawImprovement(sr.rawImprovement());
                c.setKpiImprovement(sr.kpiImprovement());
                c.setRisk(sr.risk());
                c.setScore(sr.score());
                c.setImprovementBreakdownJson(json.write(sr.improvementBreakdown()));
                c.setRiskBreakdownJson(json.write(sr.riskBreakdown()));
                c.setStatus(sr.rawImprovement() > p.getMinImprovement() ? CandidateStatus.SELECTABLE : CandidateStatus.NO_GAIN);
                s = new Scored(c, a, bk, ck, sr);
            } catch (Exception ex) {
                c.setStatus(CandidateStatus.SIMULATION_FAILED);
                c.setNote(JsonCodec.truncate(ex.getMessage(), 1000));
                c.setScore(-1);
                s = new Scored(c, a, baseKpi, null, null);
            }
            c = cands.save(c);
            s = new Scored(c, s.action(), s.baseKpi(), s.kpi(), s.score());
            scored.add(s);
            audit.record(AuditType.TWIN_SIMULATED, "SYSTEM:twin", recId, null,
                    s.score() == null
                            ? "Twin could not simulate: " + a.description() + " (" + c.getNote() + ")"
                            : String.format("Twin: %s -> score %.3f (improvement %.3f, risk %.3f, %s)", a.description(),
                            c.getScore(), c.getKpiImprovement(), c.getRisk(), c.getStatus()),
                    s.kpi());
        }

        // ---- rank: selectable first by score (tie: lower risk), then the rest by score
        Comparator<Scored> byScore = Comparator
                .comparingInt((Scored s) -> s.entity().getStatus() == CandidateStatus.SELECTABLE ? 0 : 1)
                .thenComparing(Comparator.comparingDouble((Scored s) -> s.entity().getScore()).reversed())
                .thenComparingDouble(s -> s.entity().getRisk());
        scored.sort(byScore);
        for (int i = 0; i < scored.size(); i++) {
            RecommendationCandidate c = scored.get(i).entity();
            c.setRankNo(i + 1);
            cands.save(c);
        }

        Scored selected = scored.get(0);
        if (selected.entity().getStatus() != CandidateStatus.SELECTABLE) {
            finishNoAction(r, scored, p);
            return;
        }
        Scored alternative = scored.size() > 1 ? scored.get(1) : null;

        r = recs.findById(recId).orElseThrow();
        r.setSelectedCandidateId(selected.entity().getId());
        r.setAlternativeCandidateId(alternative == null ? null : alternative.entity().getId());
        r.setWhySelected(JsonCodec.truncate(explanations.whySelected(selected, p), 4000));
        r.setWhyNotAlternative(JsonCodec.truncate(explanations.whyNotAlternative(selected, alternative, p), 4000));
        r.setCounterfactual(JsonCodec.truncate(explanations.counterfactual(selected, alternative, p), 4000));
        r.setHumanImpact(JsonCodec.truncate(impact.translate(t, f, selected, classPaths), 4000));
        r.setApprovalMode(p.getApprovalMode().name());
        r.setStatus(RecommendationStatus.PENDING_APPROVAL);
        r.setExpiresAt(Instant.now().plus(Duration.ofMinutes(p.getRecommendationTtlMinutes())));
        r.setUpdatedAt(Instant.now());
        recs.save(r);
        audit.record(AuditType.RECOMMENDATION_READY, "SYSTEM", recId, null,
                String.format("Recommendation ready: %s (score %.3f)", selected.action().description(),
                        selected.entity().getScore()),
                Map.of("whySelected", r.getWhySelected(), "whyNotAlternative", r.getWhyNotAlternative()));

        approval.tryAutoApprove(recId, selected.entity(), p);
    }

    private void finishNoAction(Recommendation r, List<Scored> scored, PolicyConfig p) {
        Recommendation fresh = recs.findById(r.getId()).orElse(r);
        fresh.setStatus(RecommendationStatus.NO_ACTION_RECOMMENDED);
        fresh.setWhySelected(JsonCodec.truncate(explanations.noAction(scored, p), 4000));
        fresh.setUpdatedAt(Instant.now());
        recs.save(fresh);
        audit.record(AuditType.RECOMMENDATION_NO_ACTION, "SYSTEM", r.getId(), null, fresh.getWhySelected(), null);
    }

    private static double pctOrZero(Double v) {
        return v == null ? 0 : v * 100;
    }
}
