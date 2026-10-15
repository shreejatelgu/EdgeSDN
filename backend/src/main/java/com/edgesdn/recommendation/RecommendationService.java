package com.edgesdn.recommendation;

import com.edgesdn.audit.AuditService;
import com.edgesdn.audit.AuditType;
import com.edgesdn.common.Exceptions.NotFoundException;
import com.edgesdn.common.JsonCodec;
import com.edgesdn.enforcement.EnforcementRepository;
import com.edgesdn.enforcement.EnforcementStatus;
import com.edgesdn.policy.PolicyConfig;
import com.edgesdn.policy.PolicyService;
import com.edgesdn.prediction.PredictionModels.ForecastCompletedEvent;
import com.edgesdn.prediction.PredictionModels.LinkForecast;
import com.edgesdn.prediction.PredictionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;

/** Detects "action required" from forecasts and starts one pipeline per congested link (deduplicated). */
@Service
public class RecommendationService {

    private static final Logger log = LoggerFactory.getLogger(RecommendationService.class);

    public record RecommendationView(Recommendation recommendation, List<RecommendationCandidate> candidates) {
    }

    private final RecommendationRepository recs;
    private final RecommendationCandidateRepository cands;
    private final EnforcementRepository enforcements;
    private final RecommendationPipeline pipeline;
    private final ExplanationService explanations;
    private final PolicyService policies;
    private final AuditService audit;
    private final JsonCodec json;

    public RecommendationService(RecommendationRepository recs, RecommendationCandidateRepository cands,
                                 EnforcementRepository enforcements, RecommendationPipeline pipeline,
                                 ExplanationService explanations, PolicyService policies, AuditService audit,
                                 JsonCodec json) {
        this.recs = recs;
        this.cands = cands;
        this.enforcements = enforcements;
        this.pipeline = pipeline;
        this.explanations = explanations;
        this.policies = policies;
        this.audit = audit;
        this.json = json;
    }

    /** Pipelines interrupted by a restart cannot resume: mark them FAILED. */
    @EventListener(ApplicationReadyEvent.class)
    public void recoverInterrupted() {
        for (Recommendation r : recs.findByStatusIn(EnumSet.of(RecommendationStatus.SIMULATING))) {
            r.setStatus(RecommendationStatus.FAILED);
            r.setFailureReason("Interrupted by backend restart during simulation");
            r.setUpdatedAt(Instant.now());
            recs.save(r);
        }
    }

    @EventListener
    public void onForecast(ForecastCompletedEvent event) {
        PolicyConfig p = policies.get();
        Optional<LinkForecast> worst = event.run().forecasts().stream()
                .filter(f -> PredictionService.isCongested(f, p))
                .max(Comparator.comparingDouble(LinkForecast::predictedUtilization)
                        .thenComparingDouble(LinkForecast::congestionRisk));
        if (worst.isEmpty()) {
            return;
        }
        LinkForecast f = worst.get();
        Recommendation r;
        synchronized (this) {
            if (recs.existsByStatusIn(EnumSet.of(RecommendationStatus.SIMULATING))) {
                return; // the twin is busy; the next forecast cycle will re-evaluate
            }
            if (recs.existsByTargetLinkIdAndStatusIn(f.linkId(), RecommendationStatus.OPEN)) {
                return; // already handled or in progress for this link
            }
            if (enforcements.existsByStatusIn(EnforcementStatus.IN_PROGRESS)) {
                return; // do not stack decisions while another action is being monitored
            }
            r = new Recommendation();
            r.setCreatedAt(Instant.now());
            r.setUpdatedAt(r.getCreatedAt());
            r.setStatus(RecommendationStatus.SIMULATING);
            r.setTargetLinkId(f.linkId());
            r.setHorizonMinutes(f.horizonMinutes());
            r.setPredictedUtilization(f.predictedUtilization());
            r.setCongestionRisk(f.congestionRisk());
            r.setConfidence(f.confidence());
            r.setPredictionSource(JsonCodec.truncate(f.source(), 80));
            r.setPredictionRunId(event.run().runId());
            r.setFactualExplanation(JsonCodec.truncate(explanations.factual(f), 4000));
            r.setPredictionFactorsJson(JsonCodec.truncate(json.write(f.factors()), 8000));
            r.setPredictionCounterfactualsJson(JsonCodec.truncate(json.write(f.counterfactuals()), 4000));
            r.setApprovalMode(p.getApprovalMode().name());
            r = recs.save(r);
        }
        audit.record(AuditType.RECOMMENDATION_CREATED, "SYSTEM", r.getId(), null,
                String.format("Action required: %s predicted at %.0f%% in %d min; simulating candidates in the twin",
                        f.linkId(), f.predictedUtilization() * 100, f.horizonMinutes()), null);
        log.info("Recommendation {} created for link {}", r.getId(), f.linkId());
        pipeline.run(r.getId(), f);
    }

    public List<Recommendation> list(RecommendationStatus status) {
        return status == null ? recs.findTop100ByOrderByIdDesc() : recs.findTop100ByStatusOrderByIdDesc(status);
    }

    public RecommendationView view(long id) {
        Recommendation r = recs.findById(id).orElseThrow(() -> new NotFoundException("Recommendation " + id + " not found"));
        return new RecommendationView(r, cands.findByRecommendationIdOrderByRankNoAsc(id));
    }

    public List<Recommendation> open() {
        return recs.findByStatusIn(RecommendationStatus.OPEN);
    }
}
