package com.edgesdn.ml;

import com.edgesdn.common.Exceptions.ExternalServiceException;
import com.edgesdn.ml.MlModels.MlForecast;
import com.edgesdn.ml.MlModels.MlPredictResponse;
import com.edgesdn.prediction.PredictionModels.LinkForecast;
import com.edgesdn.prediction.PredictionModels.PredictionInput;
import com.edgesdn.prediction.PredictionProvider;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/** Remote provider: delegates forecasting and explanation to the Python ML service. */
@Component
public class MlPredictionProvider implements PredictionProvider {

    public static final String NAME = "ML";

    private final MlClient client;

    public MlPredictionProvider(MlClient client) {
        this.client = client;
    }

    @Override
    public String name() {
        return NAME;
    }

    @Override
    public List<LinkForecast> forecast(PredictionInput input) {
        MlPredictResponse res = client.predict(input);
        if (res == null || res.predictions() == null || res.predictions().isEmpty()) {
            throw new ExternalServiceException("ML service returned no predictions");
        }
        String version = res.modelVersion() == null ? "unknown" : res.modelVersion();
        List<LinkForecast> out = new ArrayList<>();
        for (MlForecast f : res.predictions()) {
            double p = f.predictedUtilization();
            String method = f.explanation() == null || f.explanation().method() == null ? "NONE" : f.explanation().method();
            out.add(new LinkForecast(f.linkId(), f.horizonMinutes(), p,
                    f.lower() == null ? Math.max(0, p - 0.1) : f.lower(),
                    f.upper() == null ? p + 0.1 : f.upper(),
                    f.congestionRisk(), f.confidence(), NAME + "/" + method, version,
                    f.explanation() == null || f.explanation().factors() == null ? List.of() : f.explanation().factors(),
                    f.counterfactuals() == null ? List.of() : f.counterfactuals()));
        }
        return out;
    }
}
