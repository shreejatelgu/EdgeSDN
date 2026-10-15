package com.edgesdn.ml;

import com.edgesdn.audit.AuditService;
import com.edgesdn.audit.AuditType;
import com.edgesdn.config.EdgeProperties;
import com.edgesdn.event.EventService;
import com.edgesdn.event.InstitutionalEvent;
import com.edgesdn.ml.MlModels.MlCounterfactualRequest;
import com.edgesdn.ml.MlModels.MlExplainRequest;
import com.edgesdn.prediction.PredictionProviderRegistry;
import com.edgesdn.prediction.PredictionService;
import com.edgesdn.telemetry.TelemetrySample;
import com.edgesdn.telemetry.TelemetrySampleRepository;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.security.Principal;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * ML integration endpoints of the backend:
 * status/provider switch, explanation pass-through, and training-data export for the ML team.
 */
@RestController
@RequestMapping("/api/ml")
public class MlController {

    public record ProviderRequest(String provider) {
    }

    private final MlClient client;
    private final PredictionProviderRegistry registry;
    private final PredictionService predictions;
    private final TelemetrySampleRepository telemetry;
    private final EventService events;
    private final AuditService audit;
    private final EdgeProperties props;

    public MlController(MlClient client, PredictionProviderRegistry registry, PredictionService predictions,
                        TelemetrySampleRepository telemetry, EventService events, AuditService audit,
                        EdgeProperties props) {
        this.client = client;
        this.registry = registry;
        this.predictions = predictions;
        this.telemetry = telemetry;
        this.events = events;
        this.audit = audit;
        this.props = props;
    }

    @GetMapping("/status")
    public Map<String, Object> status() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("activeProvider", registry.activeName());
        m.put("availableProviders", registry.names());
        m.put("mlBaseUrl", props.getMl().getBaseUrl());
        m.put("fallbackToRuleBased", props.getMl().isFallbackToRuleBased());
        try {
            m.put("health", client.health());
            m.put("modelInfo", client.modelInfo());
            m.put("reachable", true);
        } catch (Exception e) {
            m.put("reachable", false);
            m.put("error", e.getMessage());
        }
        return m;
    }

    @PutMapping("/provider")
    public Map<String, Object> setProvider(@RequestBody ProviderRequest request, Principal principal) {
        String before = registry.activeName();
        registry.setActive(request.provider());
        audit.record(AuditType.PROVIDER_CHANGED, principal.getName(), null, null,
                "Prediction provider changed " + before + " -> " + registry.activeName(), null);
        return Map.of("activeProvider", registry.activeName());
    }

    /** Detailed ML explanation (e.g. SHAP / LIME) for one link and horizon, computed on current data. */
    @GetMapping("/explain")
    public Map<String, Object> explain(@RequestParam String linkId,
                                       @RequestParam(defaultValue = "30") int horizonMinutes,
                                       @RequestParam(defaultValue = "SHAP") String method) {
        return client.explain(new MlExplainRequest(predictions.currentInput(), linkId, horizonMinutes, method));
    }

    @GetMapping("/counterfactual")
    public Map<String, Object> counterfactual(@RequestParam String linkId,
                                              @RequestParam(defaultValue = "30") int horizonMinutes,
                                              @RequestParam(defaultValue = "0.7") double targetUtilization,
                                              @RequestParam(defaultValue = "2") int maxChanges) {
        return client.counterfactual(new MlCounterfactualRequest(predictions.currentInput(), linkId, horizonMinutes,
                targetUtilization, maxChanges));
    }

    /** CSV: ts,subject_type,subject_id,mbps,utilization (training data for the LSTM). */
    @GetMapping("/training-data/telemetry.csv")
    public ResponseEntity<String> telemetryCsv(@RequestParam(defaultValue = "24") int hours) {
        Instant to = Instant.now();
        Instant from = to.minus(Duration.ofHours(Math.max(1, Math.min(hours, 24 * 30))));
        List<TelemetrySample> rows = telemetry.findByTsBetweenOrderByTsAsc(from, to);
        StringBuilder sb = new StringBuilder("ts,subject_type,subject_id,mbps,utilization\n");
        for (TelemetrySample s : rows) {
            sb.append(s.getTs()).append(',').append(s.getSubjectType()).append(',').append(s.getSubjectId())
                    .append(',').append(String.format("%.4f", s.getMbps()))
                    .append(',').append(String.format("%.5f", s.getUtilization())).append('\n');
        }
        return csv(sb.toString(), "telemetry.csv");
    }

    /** CSV: id,name,type,start_time,end_time,duration_minutes,expected_intensity,affected_groups */
    @GetMapping("/training-data/events.csv")
    public ResponseEntity<String> eventsCsv() {
        StringBuilder sb = new StringBuilder(
                "id,name,type,start_time,end_time,duration_minutes,expected_intensity,affected_groups\n");
        for (InstitutionalEvent e : events.list()) {
            sb.append(e.getId()).append(",\"").append(e.getName().replace("\"", "\"\"")).append("\",")
                    .append(e.getType()).append(',').append(e.getStartTime()).append(',').append(e.getEndTime())
                    .append(',').append(e.getDurationMinutes()).append(',').append(e.getExpectedIntensity())
                    .append(",\"").append(String.join(";", e.affectedGroupList())).append("\"\n");
        }
        return csv(sb.toString(), "events.csv");
    }

    private static ResponseEntity<String> csv(String body, String filename) {
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("text/csv"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .body(body);
    }
}
