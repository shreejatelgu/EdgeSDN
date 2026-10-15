package com.edgesdn.prediction;

import com.edgesdn.prediction.PredictionModels.LinkForecast;
import com.edgesdn.prediction.PredictionModels.PredictionInput;

import java.util.List;

/**
 * Layer 2 plug-in point. Implementations: RULE_BASED (in-process, no ML) and ML (remote Python service).
 * Must return one forecast per (link, horizon) in the input; may throw on failure.
 */
public interface PredictionProvider {

    String name();

    List<LinkForecast> forecast(PredictionInput input);
}
