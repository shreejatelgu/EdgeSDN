package com.edgesdn.system;

import com.edgesdn.agent.AgentClient;
import com.edgesdn.prediction.PredictionService;
import com.edgesdn.sdn.SdnControllerClient;
import com.edgesdn.telemetry.TelemetryService;
import com.edgesdn.topology.TopologyService;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
public class SystemController {

    private final AgentClient agent;
    private final SdnControllerClient controller;
    private final TopologyService topology;
    private final TelemetryService telemetry;
    private final PredictionService predictions;

    public SystemController(AgentClient agent, SdnControllerClient controller, TopologyService topology,
                            TelemetryService telemetry, PredictionService predictions) {
        this.agent = agent;
        this.controller = controller;
        this.topology = topology;
        this.telemetry = telemetry;
        this.predictions = predictions;
    }

    @GetMapping("/api/system/ping")
    public Map<String, String> ping() {
        return Map.of("status", "UP");
    }

    @GetMapping("/api/auth/me")
    public Map<String, Object> me(Authentication auth) {
        return Map.of("username", auth.getName(),
                "roles", auth.getAuthorities().stream().map(GrantedAuthority::getAuthority).toList());
    }

    @GetMapping("/api/system/health")
    public Map<String, Object> health() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("backend", "UP");
        m.put("topologyLoaded", topology.current().isPresent());
        m.put("topologyError", topology.lastError());
        m.put("controller", controller.status());
        try {
            m.put("agent", agent.health());
        } catch (Exception e) {
            m.put("agent", Map.of("status", "DOWN", "error", String.valueOf(e.getMessage())));
        }
        var t = telemetry.latest();
        m.put("telemetry", Map.of("polledAt", String.valueOf(t.polledAt()), "stale", t.stale(),
                "error", String.valueOf(t.lastError())));
        m.put("prediction", predictions.providerInfo());
        return m;
    }
}
