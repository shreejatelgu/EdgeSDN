package com.edgesdn.recommendation;

import com.edgesdn.prediction.PredictionModels.ForecastRun;
import com.edgesdn.prediction.PredictionService;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.security.Principal;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/recommendations")
public class RecommendationController {

    public record ApproveRequest(Long candidateId, @Size(max = 1000) String comment) {
    }

    public record RejectRequest(@Size(max = 1000) String reason) {
    }

    private final RecommendationService service;
    private final ApprovalService approval;
    private final PredictionService predictions;

    public RecommendationController(RecommendationService service, ApprovalService approval,
                                    PredictionService predictions) {
        this.service = service;
        this.approval = approval;
        this.predictions = predictions;
    }

    @GetMapping
    public List<Recommendation> list(@RequestParam(required = false) RecommendationStatus status) {
        return service.list(status);
    }

    @GetMapping("/{id}")
    public RecommendationService.RecommendationView get(@PathVariable long id) {
        return service.view(id);
    }

    /** Runs a forecast immediately; if congestion is predicted a recommendation pipeline starts. */
    @PostMapping("/evaluate")
    public Map<String, Object> evaluateNow() {
        ForecastRun run = predictions.runOnce(true);
        return Map.of("runId", run.runId(), "provider", run.provider(), "forecasts", run.forecasts().size());
    }

    /** candidateId is optional: omit it to approve the recommended candidate, or pass the alternative's id. */
    @PostMapping("/{id}/approve")
    public Recommendation approve(@PathVariable long id, @RequestBody(required = false) ApproveRequest body,
                                  Principal principal) {
        return approval.approve(id, body == null ? null : body.candidateId(), principal.getName(),
                body == null ? null : body.comment(), false);
    }

    @PostMapping("/{id}/reject")
    public Recommendation reject(@PathVariable long id, @RequestBody(required = false) RejectRequest body,
                                 Principal principal) {
        return approval.reject(id, principal.getName(), body == null ? null : body.reason());
    }
}
