package com.edgesdn.event;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.security.Principal;
import java.util.List;

@RestController
@RequestMapping("/api/events")
public class EventController {

    private final EventService events;

    public EventController(EventService events) {
        this.events = events;
    }

    @GetMapping
    public List<InstitutionalEvent> list() {
        return events.list();
    }

    @GetMapping("/{id}")
    public InstitutionalEvent get(@PathVariable long id) {
        return events.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public InstitutionalEvent create(@Valid @RequestBody EventRequest request, Principal principal) {
        return events.create(request, principal.getName());
    }

    @PutMapping("/{id}")
    public InstitutionalEvent update(@PathVariable long id, @Valid @RequestBody EventRequest request,
                                     Principal principal) {
        return events.update(id, request, principal.getName());
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable long id, Principal principal) {
        events.delete(id, principal.getName());
    }

    /** Body: raw CSV text (Content-Type text/plain or text/csv). */
    @PostMapping(value = "/import", consumes = {"text/plain", "text/csv"})
    public EventService.ImportResult importCsv(@RequestBody String csv, Principal principal) {
        return events.importCsv(csv, principal.getName());
    }
}
