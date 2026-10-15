package com.edgesdn.ml;

import com.edgesdn.common.Exceptions.ExternalServiceException;
import com.edgesdn.ml.MlModels.MlCounterfactualRequest;
import com.edgesdn.ml.MlModels.MlExplainRequest;
import com.edgesdn.ml.MlModels.MlPredictResponse;
import com.edgesdn.prediction.PredictionModels.PredictionInput;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.util.Map;
import java.util.function.Supplier;

/**
 * Client for the ML service endpoints:
 * GET /api/v1/health, GET /api/v1/model-info, POST /api/v1/predict,
 * POST /api/v1/explain, POST /api/v1/counterfactual.
 */
@Component
public class MlClient {

    private static final ParameterizedTypeReference<Map<String, Object>> MAP = new ParameterizedTypeReference<>() {
    };

    private final RestClient rest;

    public MlClient(@Qualifier("mlRestClient") RestClient rest) {
        this.rest = rest;
    }

    public Map<String, Object> health() {
        return call("health", () -> rest.get().uri("/api/v1/health").retrieve().body(MAP));
    }

    public Map<String, Object> modelInfo() {
        return call("model-info", () -> rest.get().uri("/api/v1/model-info").retrieve().body(MAP));
    }

    public MlPredictResponse predict(PredictionInput input) {
        return call("predict", () -> rest.post().uri("/api/v1/predict").contentType(MediaType.APPLICATION_JSON)
                .body(input).retrieve().body(MlPredictResponse.class));
    }

    public Map<String, Object> explain(MlExplainRequest request) {
        return call("explain", () -> rest.post().uri("/api/v1/explain").contentType(MediaType.APPLICATION_JSON)
                .body(request).retrieve().body(MAP));
    }

    public Map<String, Object> counterfactual(MlCounterfactualRequest request) {
        return call("counterfactual", () -> rest.post().uri("/api/v1/counterfactual")
                .contentType(MediaType.APPLICATION_JSON).body(request).retrieve().body(MAP));
    }

    private static <T> T call(String what, Supplier<T> s) {
        try {
            return s.get();
        } catch (RestClientResponseException e) {
            throw new ExternalServiceException("ML service " + what + " failed: HTTP " + e.getStatusCode().value()
                    + " " + e.getResponseBodyAsString());
        } catch (RestClientException e) {
            throw new ExternalServiceException("ML service unreachable (" + what + "): " + e.getMessage(), e);
        }
    }
}
