package com.edgesdn.prediction;

import com.edgesdn.audit.AuditService;
import com.edgesdn.audit.AuditType;
import com.edgesdn.common.Exceptions.ExternalServiceException;
import com.edgesdn.common.JsonCodec;
import com.edgesdn.config.EdgeProperties;
import com.edgesdn.event.EventService;
import com.edgesdn.event.InstitutionalEvent;
import com.edgesdn.policy.PolicyConfig;
import com.edgesdn.policy.PolicyService;
import com.edgesdn.prediction.PredictionModels.EventInfo;
import com.edgesdn.prediction.PredictionModels.ForecastCompletedEvent;
import com.edgesdn.prediction.PredictionModels.ForecastRun;
import com.edgesdn.prediction.PredictionModels.LinkForecast;
import com.edgesdn.prediction.PredictionModels.LinkHistory;
import com.edgesdn.prediction.PredictionModels.PredictionInput;
import com.edgesdn.prediction.PredictionModels.UtilPoint;
import com.edgesdn.telemetry.TelemetrySample;
import com.edgesdn.telemetry.TelemetrySampleRepository;
import com.edgesdn.topology.TopologyIndex;
import com.edgesdn.topology.TopologyModels.LinkInfo;
import com.edgesdn.topology.TopologyModels.TrafficClass;
import com.edgesdn.topology.TopologyService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static com.edgesdn.common.MathUtil.clamp;

/** Layer 2 orchestration: build input -> provider (with fallback) -> scenario overrides -> persist -> publish. */
@Service
public class PredictionService {

    private static final Logger log = LoggerFactory.getLogger(PredictionService.class);

    private final TopologyService topology;
    private final TelemetrySampleRepository telemetryRepo;
    private final EventService events;
    private final PredictionProviderRegistry registry;
    private final ScenarioService scenarios;
    private final PredictionRecordRepository records;
    private final PolicyService policies;
    private final AuditService audit;
    private final ApplicationEventPublisher publisher;
    private final EdgeProperties props;
    private final JsonCodec json;

    private volatile ForecastRun latest;
    private volatile String lastCongestionKey;

    public PredictionService(TopologyService topology, TelemetrySampleRepository telemetryRepo, EventService events,
                             PredictionProviderRegistry registry, ScenarioService scenarios,
                             PredictionRecordRepository records, PolicyService policies, AuditService audit,
                             ApplicationEventPublisher publisher, EdgeProperties props, JsonCodec json) {
        this.topology = topology;
        this.telemetryRepo = telemetryRepo;
        this.events = events;
        this.registry = registry;
        this.scenarios = scenarios;
        this.records = records;
        this.policies = policies;
        this.audit = audit;
        this.publisher = publisher;
        this.props = props;
        this.json = json;
    }

    @Scheduled(fixedDelayString = "${edge.prediction.interval-ms:60000}", initialDelay = 45000)
    public void scheduled() {
        if (topology.current().isEmpty()) {
            return;
        }
        try {
            runOnce(props.getPrediction().isAutoRecommend());
        } catch (Exception e) {
            log.warn("Scheduled prediction failed: {}", e.getMessage());
        }
    }

    public synchronized ForecastRun runOnce(boolean publish) {
        TopologyIndex t = topology.require();
        PolicyConfig policy = policies.get();
        PredictionInput input = buildInput(t, policy);

        String provider = registry.activeName();
        boolean fallback = false;
        String fallbackReason = null;
        List<LinkForecast> forecasts;
        try {
            forecasts = registry.active().forecast(input);
            if (forecasts == null || forecasts.isEmpty()) {
                throw new ExternalServiceException("Provider " + provider + " returned no forecasts");
            }
        } catch (RuntimeException e) {
            if (RuleBasedPredictionProvider.NAME.equals(provider) || !props.getMl().isFallbackToRuleBased()) {
                throw e;
            }
            fallback = true;
            fallbackReason = e.getMessage();
            forecasts = registry.ruleBased().forecast(input);
            audit.system(AuditType.PREDICTION_FALLBACK,
                    "Provider " + provider + " failed; RULE_BASED fallback used", fallbackReason);
        }

        forecasts = sanitise(t, forecasts);
        forecasts = scenarios.apply(forecasts, policy.getCongestionUtilThreshold());

        ForecastRun run = new ForecastRun(UUID.randomUUID().toString(), input.generatedAt(),
                fallback ? RuleBasedPredictionProvider.NAME + " (fallback from " + provider + ")" : provider,
                fallback, fallbackReason, List.copyOf(forecasts));
        persist(run);
        latest = run;

        Optional<LinkForecast> worst = run.forecasts().stream()
                .filter(f -> isCongested(f, policy))
                .max(Comparator.comparingDouble(LinkForecast::predictedUtilization));
        if (worst.isPresent()) {
            LinkForecast w = worst.get();
            String key = w.linkId() + "@" + w.horizonMinutes();
            if (!key.equals(lastCongestionKey)) {
                audit.system(AuditType.PREDICTION_CONGESTION, String.format(
                        "Congestion predicted on %s in %d min: %.0f%% (risk %.2f, confidence %.2f, %s)",
                        w.linkId(), w.horizonMinutes(), w.predictedUtilization() * 100, w.congestionRisk(),
                        w.confidence(), w.source()), w);
            }
            lastCongestionKey = key;
        } else {
            lastCongestionKey = null;
        }

        if (publish) {
            publisher.publishEvent(new ForecastCompletedEvent(run));
        }
        return run;
    }

    public static boolean isCongested(LinkForecast f, PolicyConfig p) {
        return f.predictedUtilization() >= p.getCongestionUtilThreshold()
                && f.congestionRisk() >= p.getCongestionRiskThreshold();
    }

    /** Input for the current moment (also used by the ML explain/counterfactual pass-through endpoints). */
    public PredictionInput currentInput() {
        return buildInput(topology.require(), policies.get());
    }

    private PredictionInput buildInput(TopologyIndex t, PolicyConfig policy) {
        Instant now = Instant.now();
        List<Integer> horizons = props.getPrediction().getHorizonsMinutes();
        int maxH = horizons.stream().mapToInt(Integer::intValue).max().orElse(60);
        Instant since = now.minus(Duration.ofMinutes(props.getPrediction().getHistoryMinutes()));

        List<LinkHistory> links = new ArrayList<>();
        for (LinkInfo l : t.links()) {
            List<UtilPoint> history = telemetryRepo
                    .findBySubjectTypeAndSubjectIdAndTsAfterOrderByTsAsc(TelemetrySample.LINK, l.id(), since)
                    .stream().map(s -> new UtilPoint(s.getTs(), s.getUtilization())).toList();
            List<String> groups = new ArrayList<>();
            for (TrafficClass c : t.trafficClasses()) {
                if (t.pathUsesLink(t.baselinePath(c), l.id())) {
                    groups.add(c.id());
                }
            }
            links.add(new LinkHistory(l.id(), l.capacityMbps(), groups, history));
        }

        List<EventInfo> ev = new ArrayList<>();
        Instant until = now.plus(Duration.ofMinutes(maxH + (long) RuleBasedPredictionProvider.RAMP_MINUTES));
        for (InstitutionalEvent e : events.overlapping(now, until)) {
            ev.add(new EventInfo(e.getId(), e.getName(), e.getType().name(), e.getStartTime(), e.getDurationMinutes(),
                    e.getExpectedIntensity(), e.affectedGroupList()));
        }
        return new PredictionInput(now, List.copyOf(horizons), policy.getCongestionUtilThreshold(), links, ev);
    }

    /** Drops forecasts for unknown links and clamps values, so a faulty provider cannot inject garbage. */
    private static List<LinkForecast> sanitise(TopologyIndex t, List<LinkForecast> in) {
        List<LinkForecast> out = new ArrayList<>();
        for (LinkForecast f : in) {
            if (f == null || f.linkId() == null || !t.hasLink(f.linkId())) {
                continue;
            }
            double p = clamp(f.predictedUtilization(), 0, 1.5);
            out.add(new LinkForecast(f.linkId(), f.horizonMinutes(), p,
                    clamp(Math.min(f.lower(), p), 0, 1.5), clamp(Math.max(f.upper(), p), 0, 1.5),
                    clamp(f.congestionRisk(), 0, 1), clamp(f.confidence(), 0, 1),
                    f.source(), f.modelVersion(),
                    f.factors() == null ? List.of() : f.factors(),
                    f.counterfactuals() == null ? List.of() : f.counterfactuals()));
        }
        return out;
    }

    private void persist(ForecastRun run) {
        List<PredictionRecord> rows = new ArrayList<>();
        for (LinkForecast f : run.forecasts()) {
            PredictionRecord r = new PredictionRecord();
            r.setRunId(run.runId());
            r.setGeneratedAt(run.generatedAt());
            r.setLinkId(f.linkId());
            r.setHorizonMinutes(f.horizonMinutes());
            r.setPredictedUtilization(f.predictedUtilization());
            r.setLowerBound(f.lower());
            r.setUpperBound(f.upper());
            r.setCongestionRisk(f.congestionRisk());
            r.setConfidence(f.confidence());
            r.setSource(JsonCodec.truncate(f.source(), 60));
            r.setModelVersion(JsonCodec.truncate(f.modelVersion(), 60));
            r.setFactorsJson(JsonCodec.truncate(json.write(f.factors()), 8000));
            r.setCounterfactualsJson(JsonCodec.truncate(json.write(f.counterfactuals()), 4000));
            rows.add(r);
        }
        records.saveAll(rows);
    }

    public ForecastRun latest() {
        return latest;
    }

    public List<PredictionRecord> history(String linkId, int minutes) {
        return records.findByLinkIdAndGeneratedAtAfterOrderByGeneratedAtAsc(linkId,
                Instant.now().minus(Duration.ofMinutes(Math.max(1, Math.min(minutes, 60 * 24 * 7)))));
    }

    @Scheduled(cron = "0 23 * * * *")
    public void cleanup() {
        records.deleteOlderThan(Instant.now().minus(Duration.ofHours(props.getTelemetry().getRetentionHours())));
    }

    public Map<String, Object> providerInfo() {
        return Map.of("active", registry.activeName(), "available", registry.names());
    }
}
