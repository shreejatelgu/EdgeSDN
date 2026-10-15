package com.edgesdn.event;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

/** Example: {"name":"Semester Examination","type":"EXAM","startTime":"2026-10-05T04:30:00Z",
 *  "durationMinutes":180,"expectedIntensity":0.85,"affectedGroups":["EXAM_HALL"]} */
public record EventRequest(
        @NotBlank @Size(max = 200) String name,
        @NotNull EventType type,
        @NotNull Instant startTime,
        @NotNull @Min(1) @Max(10080) Integer durationMinutes,
        @NotNull @DecimalMin("0.0") @DecimalMax("1.0") Double expectedIntensity,
        List<String> affectedGroups,
        @Size(max = 1000) String description) {
}
