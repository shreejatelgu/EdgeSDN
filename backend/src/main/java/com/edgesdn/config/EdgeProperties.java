package com.edgesdn.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.List;

/**
 * All EDGE-SDN settings under the "edge" prefix of application.yml.
 * Runtime-tunable decision parameters (weights, thresholds, approval mode) live in the
 * database-backed PolicyConfig instead, so the administrator can change them from the UI.
 */
@Data
@ConfigurationProperties(prefix = "edge")
public class EdgeProperties {

    private List<String> corsOrigins = new ArrayList<>(List.of("http://localhost:4200"));
    private Agent agent = new Agent();
    private Odl odl = new Odl();
    private Telemetry telemetry = new Telemetry();
    private Prediction prediction = new Prediction();
    private Ml ml = new Ml();
    private Twin twin = new Twin();
    private Monitoring monitoring = new Monitoring();
    private Network network = new Network();
    private Security security = new Security();
    private Improvement improvement = new Improvement();
    private Risk risk = new Risk();

    public enum TelemetrySource { ODL, AGENT }

    @Data
    public static class Agent {
        private String baseUrl = "http://192.168.56.101:8000";
        private String token = "change-me-agent-token";
        private int connectTimeoutMs = 3000;
        private int readTimeoutMs = 120000;
    }

    @Data
    public static class Odl {
        private String baseUrl = "http://192.168.56.101:8181";
        private String dataPath = "/rests/data";
        private String username = "admin";
        private String password = "admin";
        private int timeoutMs = 10000;
    }

    @Data
    public static class Telemetry {
        private TelemetrySource source = TelemetrySource.ODL;
        private long pollIntervalMs = 10000;
        private int retentionHours = 48;
    }

    @Data
    public static class Prediction {
        private String provider = "RULE_BASED";
        private long intervalMs = 60000;
        private List<Integer> horizonsMinutes = new ArrayList<>(List.of(15, 30, 60));
        private int historyMinutes = 30;
        private boolean autoRecommend = true;
    }

    @Data
    public static class Ml {
        private String baseUrl = "http://localhost:8001";
        private int timeoutMs = 8000;
        private boolean fallbackToRuleBased = true;
        private String apiKey = "";
    }

    @Data
    public static class Twin {
        private int durationSec = 8;
        private double minClassDemandMbps = 1.0;
        private double maxFlowRateMbps = 20.0;
    }

    @Data
    public static class Monitoring {
        private long sampleIntervalMs = 15000;
        private int consecutiveRegressions = 2;
        private int probeCount = 5;
    }

    @Data
    public static class Network {
        private boolean autoInit = true;
        private long meterBurstKb = 100;
    }

    @Data
    public static class Security {
        private String adminUsername = "admin";
        private String adminPassword = "admin123";
        private String viewerUsername = "viewer";
        private String viewerPassword = "viewer123";
    }

    /** Sub-weights of the KPIImprovement term. */
    @Data
    public static class Improvement {
        private double targetLinkUtil = 0.35;
        private double maxLinkUtil = 0.25;
        private double latency = 0.25;
        private double loss = 0.15;
    }

    /** Sub-weights of the Risk term. */
    @Data
    public static class Risk {
        private double disruption = 0.30;
        private double pathStretch = 0.20;
        private double coreTouch = 0.15;
        private double lossSpike = 0.15;
        private double priorityImpact = 0.20;
    }
}
