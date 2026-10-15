package com.edgesdn.event;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.Arrays;
import java.util.List;

@Entity
@Table(name = "institutional_event", indexes = {
        @Index(name = "idx_event_start", columnList = "start_time"),
        @Index(name = "idx_event_end", columnList = "end_time")
})
@Getter
@Setter
@NoArgsConstructor
public class InstitutionalEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 200)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private EventType type;

    @Column(name = "start_time", nullable = false)
    private Instant startTime;

    /** Derived: startTime + durationMinutes (stored to make overlap queries simple). */
    @Column(name = "end_time", nullable = false)
    private Instant endTime;

    private int durationMinutes;

    /** 0..1 - how strongly the event is expected to raise traffic of the affected groups. */
    private double expectedIntensity;

    /** Comma-separated host-group names; empty = all client groups. */
    @Column(length = 500)
    private String affectedGroups;

    @Column(length = 1000)
    private String description;

    private Instant createdAt;
    private Instant updatedAt;

    public List<String> affectedGroupList() {
        if (affectedGroups == null || affectedGroups.isBlank()) {
            return List.of();
        }
        return Arrays.stream(affectedGroups.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }
}
