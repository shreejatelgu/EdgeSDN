package com.edgesdn.system;

import com.edgesdn.audit.AuditService;
import com.edgesdn.audit.AuditType;
import com.edgesdn.event.EventRepository;
import com.edgesdn.event.EventType;
import com.edgesdn.event.InstitutionalEvent;
import com.edgesdn.policy.PolicyService;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

/** Creates the default policy row and synthetic sample events on an empty database. */
@Component
public class DataSeeder implements ApplicationRunner {

    private final PolicyService policies;
    private final EventRepository events;
    private final AuditService audit;

    public DataSeeder(PolicyService policies, EventRepository events, AuditService audit) {
        this.policies = policies;
        this.events = events;
        this.audit = audit;
    }

    @Override
    public void run(ApplicationArguments args) {
        policies.get();
        if (events.count() == 0) {
            Instant now = Instant.now().truncatedTo(ChronoUnit.MINUTES);
            save("Semester Examination (online portal)", EventType.EXAM, now.plus(Duration.ofMinutes(20)), 180, 0.85,
                    "EXAM_HALL", "Synthetic sample event: end-semester online examination");
            save("Placement Drive - Online Assessment", EventType.PLACEMENT, now.plus(Duration.ofDays(1)), 240, 0.70,
                    "LAB,ADMIN", "Synthetic sample event: company aptitude test in the labs");
            save("Cultural Festival Live Stream", EventType.FESTIVAL, now.plus(Duration.ofDays(3)), 300, 0.90,
                    "HOSTEL,LIBRARY", "Synthetic sample event: festival streaming to hostel and library");
        }
        audit.system(AuditType.SYSTEM_STARTED, "EDGE-SDN backend started", null);
    }

    private void save(String name, EventType type, Instant start, int minutes, double intensity, String groups,
                      String description) {
        InstitutionalEvent e = new InstitutionalEvent();
        e.setName(name);
        e.setType(type);
        e.setStartTime(start);
        e.setDurationMinutes(minutes);
        e.setEndTime(start.plus(Duration.ofMinutes(minutes)));
        e.setExpectedIntensity(intensity);
        e.setAffectedGroups(groups);
        e.setDescription(description);
        e.setCreatedAt(Instant.now());
        e.setUpdatedAt(e.getCreatedAt());
        events.save(e);
    }
}
