package com.edgesdn.telemetry;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/telemetry")
public class TelemetryController {

    private final TelemetryService telemetry;

    public TelemetryController(TelemetryService telemetry) {
        this.telemetry = telemetry;
    }

    @GetMapping("/latest")
    public TelemetryService.TelemetrySnapshot latest() {
        return telemetry.latest();
    }

    @GetMapping("/history")
    public List<TelemetrySample> history(@RequestParam(defaultValue = "LINK") String subjectType,
                                         @RequestParam String subjectId,
                                         @RequestParam(defaultValue = "30") int minutes) {
        return telemetry.history(subjectType.toUpperCase(), subjectId, minutes);
    }
}
