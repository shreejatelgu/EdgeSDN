package com.edgesdn.audit;

import com.edgesdn.common.JsonCodec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.List;

@Service
public class AuditService {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);
    private static final String GENESIS = "GENESIS";

    private final AuditRepository repo;
    private final JsonCodec json;
    private String lastHash;

    public AuditService(AuditRepository repo, JsonCodec json) {
        this.repo = repo;
        this.json = json;
    }

    public record VerifyResult(boolean valid, long checked, Long firstBrokenId, String message) {
    }

    /** Records an audit event. Never throws: auditing failures are logged, not propagated. */
    public synchronized AuditEvent record(AuditType type, String actor, Long recommendationId, Long enforcementId,
                                          String summary, Object details) {
        try {
            if (lastHash == null) {
                lastHash = repo.findTopByOrderByIdDesc().map(AuditEvent::getHash).orElse(GENESIS);
            }
            AuditEvent e = new AuditEvent();
            e.setTs(Instant.now().truncatedTo(ChronoUnit.MILLIS));
            e.setActor(actor == null ? "SYSTEM" : JsonCodec.truncate(actor, 100));
            e.setType(type);
            e.setRecommendationId(recommendationId);
            e.setEnforcementId(enforcementId);
            e.setSummary(JsonCodec.truncate(summary, 1000));
            String d = details == null ? null : (details instanceof String s ? s : json.write(details));
            e.setDetails(JsonCodec.truncate(d, 20000));
            e.setPrevHash(lastHash);
            e.setHash(sha256(canonical(e)));
            AuditEvent saved = repo.save(e);
            lastHash = saved.getHash();
            return saved;
        } catch (Exception ex) {
            log.error("Audit write failed for {}: {}", type, ex.getMessage());
            lastHash = null; // re-read the chain head on next write
            return null;
        }
    }

    public AuditEvent system(AuditType type, String summary, Object details) {
        return record(type, "SYSTEM", null, null, summary, details);
    }

    public Page<AuditEvent> search(AuditType type, Long recommendationId, int page, int size) {
        PageRequest pr = PageRequest.of(Math.max(0, page), Math.min(Math.max(1, size), 500));
        if (type != null && recommendationId != null) {
            return repo.findByTypeAndRecommendationIdOrderByIdDesc(type, recommendationId, pr);
        }
        if (type != null) {
            return repo.findByTypeOrderByIdDesc(type, pr);
        }
        if (recommendationId != null) {
            return repo.findByRecommendationIdOrderByIdDesc(recommendationId, pr);
        }
        return repo.findAllByOrderByIdDesc(pr);
    }

    public synchronized VerifyResult verify() {
        List<AuditEvent> all = repo.findAllByOrderByIdAsc();
        String prev = GENESIS;
        for (AuditEvent e : all) {
            if (!prev.equals(e.getPrevHash())) {
                return new VerifyResult(false, all.size(), e.getId(), "Chain broken: prevHash mismatch at id " + e.getId());
            }
            if (!sha256(canonical(e)).equals(e.getHash())) {
                return new VerifyResult(false, all.size(), e.getId(), "Content hash mismatch at id " + e.getId());
            }
            prev = e.getHash();
        }
        return new VerifyResult(true, all.size(), null, "Audit chain intact");
    }

    private static String canonical(AuditEvent e) {
        return String.join("|",
                String.valueOf(e.getPrevHash()),
                e.getTs().truncatedTo(ChronoUnit.MILLIS).toString(),
                String.valueOf(e.getActor()),
                e.getType().name(),
                String.valueOf(e.getRecommendationId()),
                String.valueOf(e.getEnforcementId()),
                e.getSummary() == null ? "" : e.getSummary(),
                e.getDetails() == null ? "" : e.getDetails());
    }

    private static String sha256(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
