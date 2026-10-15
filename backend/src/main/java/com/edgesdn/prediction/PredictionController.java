package com.edgesdn.prediction;

import com.edgesdn.prediction.PredictionModels.ForecastRun;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.security.Principal;
import java.util.List;
import java.util.Map;

@RestController
public class PredictionController {

    private final PredictionService predictions;
    private final ScenarioService scenarios;

    public PredictionController(PredictionService predictions, ScenarioService scenarios) {
        this.predictions = predictions;
        this.scenarios = scenarios;
    }

    @GetMapping("/api/predictions/latest")
    public ResponseEntity<ForecastRun> latest() {
        ForecastRun run = predictions.latest();
        return run == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(run);
    }

    /** Runs a forecast now and (if congestion is found) starts the recommendation pipeline. */
    @PostMapping("/api/predictions/run")
    public ForecastRun runNow() {
        return predictions.runOnce(true);
    }

    @GetMapping("/api/predictions/history")
    public List<PredictionRecord> history(@RequestParam String linkId,
                                          @RequestParam(defaultValue = "120") int minutes) {
        return predictions.history(linkId, minutes);
    }

    @GetMapping("/api/scenarios")
    public List<ScenarioService.ScenarioOverride> scenarios() {
        return scenarios.list();
    }

    @PostMapping("/api/scenarios")
    @ResponseStatus(HttpStatus.CREATED)
    public ScenarioService.ScenarioOverride addScenario(@Valid @RequestBody ScenarioService.ScenarioRequest request,
                                                        Principal principal) {
        return scenarios.add(request, principal.getName());
    }

    @DeleteMapping("/api/scenarios/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeScenario(@PathVariable String id, Principal principal) {
        scenarios.remove(id, principal.getName());
    }

    @DeleteMapping("/api/scenarios")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void clearScenarios(Principal principal) {
        scenarios.clear(principal.getName());
    }

    @PostMapping("/api/scenarios/live-traffic")
    public Map<String, Object> startLiveTraffic(@Valid @RequestBody ScenarioService.LiveTrafficCommand cmd,
                                                Principal principal) {
        return scenarios.startLiveTraffic(cmd, principal.getName());
    }

    @PostMapping("/api/scenarios/live-traffic/stop")
    public Map<String, Object> stopLiveTraffic(Principal principal) {
        return scenarios.stopLiveTraffic(principal.getName());
    }
}
