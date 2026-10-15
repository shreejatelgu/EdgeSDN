package com.edgesdn.recommendation;

import com.edgesdn.audit.AuditService;
import com.edgesdn.audit.AuditType;
import com.edgesdn.common.Exceptions.BadRequestException;
import com.edgesdn.common.Exceptions.ConflictException;
import com.edgesdn.common.Exceptions.NotFoundException;
import com.edgesdn.common.JsonCodec;
import com.edgesdn.enforcement.EnforcementService;
import com.edgesdn.policy.ApprovalMode;
import com.edgesdn.policy.PolicyConfig;
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

/**
 * Human-in-the-loop decision point. MANUAL: the administrator approves or rejects.
 * AUTO_LOW_RISK: the selected candidate is approved by policy only if ALL conditions hold
 * (risk, score, confidence, allowed action type, hourly limit); otherwise it waits for the administrator.
 */
@Service
public class ApprovalService {

    private static final Logger log = LoggerFactory.getLogger(ApprovalService.class);
    public static final String AUTO_ACTOR = "SYSTEM:auto-policy";

    private final RecommendationRepository recs;
    private final RecommendationCandidateRepository cands;
    private final EnforcementService enforcement;
    private final AuditService audit;
    private final Object lock = new Object();

    public ApprovalService(RecommendationRepository recs, RecommendationCandidateRepository cands,
                           EnforcementService enforcement, AuditService audit) {
        this.recs = recs;
        this.cands = cands;
        this.enforcement = enforcement;
        this.audit = audit;
    }

    /**
     * Approves the recommendation (optionally choosing a different eligible candidate) and applies it.
     * Returns the recommendation after the enforcement attempt.
     */
    public Recommendation approve(long recId, Long candidateId, String actor, String comment, boolean auto) {
        Recommendation r;
        RecommendationCandidate c;
        synchronized (lock) {
            r = recs.findById(recId).orElseThrow(() -> new NotFoundException("Recommendation " + recId + " not found"));
            if (r.getStatus() != RecommendationStatus.PENDING_APPROVAL) {
                throw new ConflictException("Recommendation " + recId + " is " + r.getStatus() + ", not PENDING_APPROVAL");
            }
            if (r.getExpiresAt() != null && Instant.now().isAfter(r.getExpiresAt())) {
                expire(r);
                throw new ConflictException("Recommendation " + recId + " has expired; the network state may have changed");
            }
            Long cid = candidateId != null ? candidateId : r.getSelectedCandidateId();
            if (cid == null) {
                throw new BadRequestException("No candidate selected");
            }
            c = cands.findById(cid)
                    .filter(x -> x.getRecommendationId().equals(recId))
                    .orElseThrow(() -> new BadRequestException("Candidate " + cid + " does not belong to recommendation " + recId));
            if (c.getStatus() != CandidateStatus.SELECTABLE) {
                throw new BadRequestException("Candidate " + cid + " is " + c.getStatus()
                        + " and cannot be applied (it was not validated as an improvement in the twin)");
            }
            enforcement.assertCanApply(c);

            boolean override = !cid.equals(r.getSelectedCandidateId());
            r.setStatus(auto ? RecommendationStatus.AUTO_APPROVED : RecommendationStatus.APPROVED);
            r.setDecidedBy(actor);
            r.setDecidedAt(Instant.now());
            r.setDecisionComment(comment);
            r.setApprovedCandidateId(cid);
            r.setUpdatedAt(Instant.now());
            r = recs.save(r);

            Map<String, Object> details = new LinkedHashMap<>();
            details.put("candidateId", cid);
            details.put("action", c.getDescription());
            details.put("score", c.getScore());
            details.put("risk", c.getRisk());
            details.put("overrodeRecommendedCandidate", override);
            audit.record(auto ? AuditType.AUTO_APPROVED : AuditType.APPROVED, actor, recId, null,
                    (auto ? "Auto-approved by policy: " : "Approved by " + actor + ": ") + c.getDescription()
                            + (override ? " (administrator chose the alternative)" : ""), details);
        }
        enforcement.apply(r, c, actor);
        return recs.findById(recId).orElse(r);
    }

    public Recommendation reject(long recId, String actor, String reason) {
        synchronized (lock) {
            Recommendation r = recs.findById(recId)
                    .orElseThrow(() -> new NotFoundException("Recommendation " + recId + " not found"));
            if (r.getStatus() != RecommendationStatus.PENDING_APPROVAL) {
                throw new ConflictException("Recommendation " + recId + " is " + r.getStatus() + ", not PENDING_APPROVAL");
            }
            r.setStatus(RecommendationStatus.REJECTED);
            r.setDecidedBy(actor);
            r.setDecidedAt(Instant.now());
            r.setDecisionComment(reason);
            r.setUpdatedAt(Instant.now());
            r = recs.save(r);
            audit.record(AuditType.REJECTED, actor, recId, null,
                    "Rejected by " + actor + (reason == null || reason.isBlank() ? "" : ": " + reason), null);
            return r;
        }
    }

    /** Called by the pipeline once a recommendation is PENDING_APPROVAL. */
    public void tryAutoApprove(long recId, RecommendationCandidate c, PolicyConfig p) {
        Recommendation r = recs.findById(recId).orElse(null);
        if (r == null) {
            return;
        }
        if (p.getApprovalMode() != ApprovalMode.AUTO_LOW_RISK) {
            r.setAutoApprovalNote("Manual approval mode: an administrator decision is required.");
            recs.save(r);
            return;
        }
        List<String> failed = new ArrayList<>();
        if (c.getRisk() > p.getAutoMaxRisk()) {
            failed.add(String.format("risk %.3f > max %.3f", c.getRisk(), p.getAutoMaxRisk()));
        }
        if (c.getScore() < p.getAutoMinScore()) {
            failed.add(String.format("score %.3f < min %.3f", c.getScore(), p.getAutoMinScore()));
        }
        if (c.getConfidence() < p.getAutoMinConfidence()) {
            failed.add(String.format("confidence %.3f < min %.3f", c.getConfidence(), p.getAutoMinConfidence()));
        }
        if (!p.allowedAutoActionList().contains(c.getActionType().name())) {
            failed.add("action " + c.getActionType() + " not in auto-allowed list " + p.allowedAutoActionList());
        }
        long lastHour = recs.countByDecidedByAndDecidedAtAfter(AUTO_ACTOR, Instant.now().minus(Duration.ofHours(1)));
        if (lastHour >= p.getAutoMaxPerHour()) {
            failed.add("hourly auto-approval limit reached (" + lastHour + "/" + p.getAutoMaxPerHour() + ")");
        }
        if (!failed.isEmpty()) {
            r.setAutoApprovalNote(note("Auto-approval not applied: " + String.join("; ", failed)));
            recs.save(r);
            audit.record(AuditType.AUTO_APPROVAL_SKIPPED, AUTO_ACTOR, recId, null, r.getAutoApprovalNote(), null);
            return;
        }
        String approvedNote = String.format("Auto-approved: risk %.3f <= %.3f, score %.3f >= %.3f, confidence %.3f >= %.3f, "
                        + "action %s allowed, %d/%d auto-approvals in the last hour",
                c.getRisk(), p.getAutoMaxRisk(), c.getScore(), p.getAutoMinScore(), c.getConfidence(),
                p.getAutoMinConfidence(), c.getActionType(), lastHour, p.getAutoMaxPerHour());
        r.setAutoApprovalNote(note(approvedNote));
        recs.save(r);
        try {
            approve(recId, c.getId(), AUTO_ACTOR, note(approvedNote), true);
        } catch (Exception e) {
            log.warn("Auto-approval of recommendation {} could not proceed: {}", recId, e.getMessage());
            recs.findById(recId).ifPresent(x -> {
                x.setAutoApprovalNote(note(approvedNote + " | not applied: " + e.getMessage()));
                recs.save(x);
            });
        }
    }

    @Scheduled(fixedDelay = 30000, initialDelay = 30000)
    public void expireStale() {
        for (Recommendation r : recs.findByStatusAndExpiresAtBefore(RecommendationStatus.PENDING_APPROVAL, Instant.now())) {
            synchronized (lock) {
                expire(r);
            }
        }
    }

    private void expire(Recommendation r) {
        r.setStatus(RecommendationStatus.EXPIRED);
        r.setUpdatedAt(Instant.now());
        recs.save(r);
        audit.record(AuditType.EXPIRED, "SYSTEM", r.getId(), null,
                "Recommendation expired without a decision (TTL reached)", null);
    }

    private static String note(String s) {
        return JsonCodec.truncate(s, 1000);
    }
}
