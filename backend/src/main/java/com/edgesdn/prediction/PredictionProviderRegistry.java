package com.edgesdn.prediction;

import com.edgesdn.common.Exceptions.BadRequestException;
import com.edgesdn.config.EdgeProperties;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Holds all providers and the currently active one (switchable at runtime from the UI). */
@Component
public class PredictionProviderRegistry {

    private final Map<String, PredictionProvider> providers = new LinkedHashMap<>();
    private volatile String active;

    public PredictionProviderRegistry(List<PredictionProvider> list, EdgeProperties props) {
        for (PredictionProvider p : list) {
            providers.put(p.name(), p);
        }
        String configured = props.getPrediction().getProvider() == null
                ? RuleBasedPredictionProvider.NAME
                : props.getPrediction().getProvider().toUpperCase(Locale.ROOT);
        this.active = providers.containsKey(configured) ? configured : RuleBasedPredictionProvider.NAME;
    }

    public PredictionProvider active() {
        return providers.get(active);
    }

    public String activeName() {
        return active;
    }

    public PredictionProvider ruleBased() {
        return providers.get(RuleBasedPredictionProvider.NAME);
    }

    public List<String> names() {
        return List.copyOf(providers.keySet());
    }

    public void setActive(String name) {
        String n = name == null ? "" : name.toUpperCase(Locale.ROOT);
        if (!providers.containsKey(n)) {
            throw new BadRequestException("Unknown provider " + name + "; available: " + providers.keySet());
        }
        this.active = n;
    }
}
