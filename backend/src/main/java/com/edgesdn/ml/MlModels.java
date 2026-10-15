package com.edgesdn.ml;

import com.edgesdn.prediction.PredictionModels.Counterfactual;
import com.edgesdn.prediction.PredictionModels.Factor;
import com.edgesdn.prediction.PredictionModels.PredictionInput;

import java.util.List;

/** Wire format of the external ML service (FastAPI). Request of /predict is PredictionInput itself. */
public final class MlModels {

    private MlModels() {
    }

    /** method: e.g. "SHAP", "LIME", "NONE". */
    public record MlExplanation(String method, List<Factor> factors, String summary) {
    }

    public record MlForecast(String linkId, int horizonMinutes, double predictedUtilization, Double lower,
                             Double upper, double congestionRisk, double confidence, MlExplanation explanation,
                             List<Counterfactual> counterfactuals) {
    }

    public record MlPredictResponse(String modelVersion, List<MlForecast> predictions) {
    }

    public record MlExplainRequest(PredictionInput input, String linkId, int horizonMinutes, String method) {
    }

    public record MlCounterfactualRequest(PredictionInput input, String linkId, int horizonMinutes,
                                          double targetUtilization, int maxChanges) {
    }
}
