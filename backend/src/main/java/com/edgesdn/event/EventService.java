package com.edgesdn.event;

import com.edgesdn.audit.AuditService;
import com.edgesdn.audit.AuditType;
import com.edgesdn.common.Exceptions.BadRequestException;
import com.edgesdn.common.Exceptions.NotFoundException;
import com.edgesdn.topology.TopologyService;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;

/** Layer 1 - institutional event ingestion (manual CRUD + CSV import). */
@Service
public class EventService {

    public record ImportResult(int imported, List<String> errors) {
    }

    private final EventRepository repo;
    private final TopologyService topology;
    private final AuditService audit;

    public EventService(EventRepository repo, TopologyService topology, AuditService audit) {
        this.repo = repo;
        this.topology = topology;
        this.audit = audit;
    }

    public List<InstitutionalEvent> list() {
        return repo.findAllByOrderByStartTimeDesc();
    }

    public InstitutionalEvent get(long id) {
        return repo.findById(id).orElseThrow(() -> new NotFoundException("Event " + id + " not found"));
    }

    public List<InstitutionalEvent> overlapping(Instant from, Instant to) {
        return repo.findOverlapping(from, to);
    }

    public InstitutionalEvent create(EventRequest r, String actor) {
        InstitutionalEvent e = new InstitutionalEvent();
        apply(e, r);
        e.setCreatedAt(Instant.now());
        e.setUpdatedAt(e.getCreatedAt());
        InstitutionalEvent saved = repo.save(e);
        audit.record(AuditType.EVENT_CREATED, actor, null, null, "Event created: " + saved.getName(), r);
        return saved;
    }

    public InstitutionalEvent update(long id, EventRequest r, String actor) {
        InstitutionalEvent e = get(id);
        apply(e, r);
        e.setUpdatedAt(Instant.now());
        InstitutionalEvent saved = repo.save(e);
        audit.record(AuditType.EVENT_UPDATED, actor, null, null, "Event updated: " + saved.getName(), r);
        return saved;
    }

    public void delete(long id, String actor) {
        InstitutionalEvent e = get(id);
        repo.delete(e);
        audit.record(AuditType.EVENT_DELETED, actor, null, null, "Event deleted: " + e.getName(), null);
    }

    private void apply(InstitutionalEvent e, EventRequest r) {
        e.setName(r.name().trim());
        e.setType(r.type());
        e.setStartTime(r.startTime());
        e.setDurationMinutes(r.durationMinutes());
        e.setEndTime(r.startTime().plus(Duration.ofMinutes(r.durationMinutes())));
        e.setExpectedIntensity(r.expectedIntensity());
        e.setAffectedGroups(normaliseGroups(r.affectedGroups()));
        e.setDescription(r.description());
    }

    private String normaliseGroups(List<String> groups) {
        if (groups == null) {
            return "";
        }
        List<String> clean = groups.stream().filter(g -> g != null && !g.isBlank())
                .map(g -> g.trim().toUpperCase(Locale.ROOT)).distinct().toList();
        topology.current().ifPresent(t -> {
            for (String g : clean) {
                if (!t.hasGroup(g) || t.group(g).server()) {
                    throw new BadRequestException("Unknown client host group: " + g);
                }
            }
        });
        return String.join(",", clean);
    }

    /**
     * CSV with header: name,type,startTime,durationMinutes,expectedIntensity,affectedGroups,description
     * affectedGroups are separated by ';'. startTime is ISO-8601 UTC, e.g. 2026-10-05T04:30:00Z.
     */
    public ImportResult importCsv(String csv, String actor) {
        if (csv == null || csv.isBlank()) {
            throw new BadRequestException("CSV body is empty");
        }
        String[] lines = csv.replace("\r", "").split("\n");
        List<String> errors = new ArrayList<>();
        int imported = 0;
        for (int i = 1; i < lines.length; i++) {
            String line = lines[i].trim();
            if (line.isEmpty()) {
                continue;
            }
            try {
                List<String> f = parseCsvLine(line);
                if (f.size() < 5) {
                    throw new BadRequestException("expected at least 5 columns");
                }
                List<String> groups = f.size() > 5 && !f.get(5).isBlank()
                        ? Arrays.stream(f.get(5).split(";")).map(String::trim).toList()
                        : List.of();
                EventRequest r = new EventRequest(
                        f.get(0),
                        EventType.valueOf(f.get(1).trim().toUpperCase(Locale.ROOT)),
                        Instant.parse(f.get(2).trim()),
                        Integer.parseInt(f.get(3).trim()),
                        Double.parseDouble(f.get(4).trim()),
                        groups,
                        f.size() > 6 ? f.get(6) : null);
                validate(r);
                InstitutionalEvent e = new InstitutionalEvent();
                apply(e, r);
                e.setCreatedAt(Instant.now());
                e.setUpdatedAt(e.getCreatedAt());
                repo.save(e);
                imported++;
            } catch (DateTimeParseException | IllegalArgumentException | BadRequestException ex) {
                errors.add("line " + (i + 1) + ": " + ex.getMessage());
            }
        }
        audit.record(AuditType.EVENTS_IMPORTED, actor, null, null,
                "Imported " + imported + " events (" + errors.size() + " errors)", errors);
        return new ImportResult(imported, errors);
    }

    private static void validate(EventRequest r) {
        if (r.name() == null || r.name().isBlank()) {
            throw new BadRequestException("name is required");
        }
        if (r.durationMinutes() < 1 || r.durationMinutes() > 10080) {
            throw new BadRequestException("durationMinutes must be 1..10080");
        }
        if (r.expectedIntensity() < 0 || r.expectedIntensity() > 1) {
            throw new BadRequestException("expectedIntensity must be 0..1");
        }
    }

    /** Minimal RFC-4180 style parser (supports quoted fields with commas and doubled quotes). */
    static List<String> parseCsvLine(String line) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (quoted) {
                if (c == '"' && i + 1 < line.length() && line.charAt(i + 1) == '"') {
                    cur.append('"');
                    i++;
                } else if (c == '"') {
                    quoted = false;
                } else {
                    cur.append(c);
                }
            } else if (c == '"') {
                quoted = true;
            } else if (c == ',') {
                out.add(cur.toString());
                cur.setLength(0);
            } else {
                cur.append(c);
            }
        }
        out.add(cur.toString());
        return out.stream().map(String::trim).collect(Collectors.toList());
    }
}
