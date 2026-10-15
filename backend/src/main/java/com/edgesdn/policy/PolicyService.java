package com.edgesdn.policy;

import com.edgesdn.audit.AuditService;
import com.edgesdn.audit.AuditType;
import com.edgesdn.common.Exceptions.BadRequestException;
import com.edgesdn.recommendation.ActionType;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class PolicyService {

    private final PolicyRepository repo;
    private final AuditService audit;
    private volatile PolicyConfig cached;

    public PolicyService(PolicyRepository repo, AuditService audit) {
        this.repo = repo;
        this.audit = audit;
    }

    /** Returns the current policy (detached copy; callers must treat it as read-only). */
    public PolicyConfig get() {
        PolicyConfig p = cached;
        if (p == null) {
            synchronized (this) {
                if (cached == null) {
                    cached = repo.findById(PolicyConfig.SINGLETON_ID).orElseGet(() -> {
                        PolicyConfig d = new PolicyConfig();
                        d.setUpdatedAt(Instant.now());
                        d.setUpdatedBy("SYSTEM:default");
                        return repo.save(d);
                    });
                }
                p = cached;
            }
        }
        return p;
    }

    public synchronized PolicyConfig update(PolicyUpdateRequest r, String actor) {
        if (r.weightImprovement() + r.weightConfidence() + r.weightRisk() <= 0) {
            throw new BadRequestException("At least one score weight must be > 0");
        }
        String allowed = normaliseActions(r.autoAllowedActions());
        PolicyConfig before = get();
        Map<String, Object> beforeView = view(before);

        PolicyConfig p = repo.findById(PolicyConfig.SINGLETON_ID).orElseGet(PolicyConfig::new);
        p.setApprovalMode(r.approvalMode());
        p.setWeightImprovement(r.weightImprovement());
        p.setWeightConfidence(r.weightConfidence());
        p.setWeightRisk(r.weightRisk());
        p.setCongestionUtilThreshold(r.congestionUtilThreshold());
        p.setCongestionRiskThreshold(r.congestionRiskThreshold());
        p.setMinImprovement(r.minImprovement());
        p.setMaxCandidates(r.maxCandidates());
        p.setRateLimitFraction(r.rateLimitFraction());
        p.setAutoMaxRisk(r.autoMaxRisk());
        p.setAutoMinScore(r.autoMinScore());
        p.setAutoMinConfidence(r.autoMinConfidence());
        p.setAutoAllowedActions(allowed);
        p.setAutoMaxPerHour(r.autoMaxPerHour());
        p.setRecommendationTtlMinutes(r.recommendationTtlMinutes());
        p.setMonitorWindowSec(r.monitorWindowSec());
        p.setRollbackUtilIncreasePct(r.rollbackUtilIncreasePct());
        p.setRollbackLatencyIncreasePct(r.rollbackLatencyIncreasePct());
        p.setRollbackLossPct(r.rollbackLossPct());
        p.setUpdatedAt(Instant.now());
        p.setUpdatedBy(actor);
        PolicyConfig saved = repo.save(p);
        cached = saved;

        audit.record(AuditType.POLICY_UPDATED, actor, null, null,
                "Policy updated (approval mode " + saved.getApprovalMode() + ")",
                Map.of("before", beforeView, "after", view(saved)));
        return saved;
    }

    private static String normaliseActions(String csv) {
        if (csv == null || csv.isBlank()) {
            return "";
        }
        return Arrays.stream(csv.split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).map(String::toUpperCase)
                .peek(s -> {
                    try {
                        ActionType.valueOf(s);
                    } catch (IllegalArgumentException e) {
                        throw new BadRequestException("Unknown action type in autoAllowedActions: " + s);
                    }
                })
                .distinct()
                .collect(Collectors.joining(","));
    }

    private static Map<String, Object> view(PolicyConfig p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("approvalMode", p.getApprovalMode());
        m.put("weights", Map.of("improvement", p.getWeightImprovement(), "confidence", p.getWeightConfidence(),
                "risk", p.getWeightRisk()));
        m.put("congestionUtilThreshold", p.getCongestionUtilThreshold());
        m.put("congestionRiskThreshold", p.getCongestionRiskThreshold());
        m.put("minImprovement", p.getMinImprovement());
        m.put("maxCandidates", p.getMaxCandidates());
        m.put("rateLimitFraction", p.getRateLimitFraction());
        m.put("autoMaxRisk", p.getAutoMaxRisk());
        m.put("autoMinScore", p.getAutoMinScore());
        m.put("autoMinConfidence", p.getAutoMinConfidence());
        m.put("autoAllowedActions", p.getAutoAllowedActions());
        m.put("autoMaxPerHour", p.getAutoMaxPerHour());
        m.put("recommendationTtlMinutes", p.getRecommendationTtlMinutes());
        m.put("monitorWindowSec", p.getMonitorWindowSec());
        m.put("rollbackUtilIncreasePct", p.getRollbackUtilIncreasePct());
        m.put("rollbackLatencyIncreasePct", p.getRollbackLatencyIncreasePct());
        m.put("rollbackLossPct", p.getRollbackLossPct());
        return m;
    }
}
