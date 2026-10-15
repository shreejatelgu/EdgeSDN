package com.edgesdn.enforcement;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.security.Principal;
import java.util.List;

@RestController
@RequestMapping("/api/enforcements")
public class EnforcementController {

    public record RevertRequest(String reason) {
    }

    private final EnforcementService enforcement;

    public EnforcementController(EnforcementService enforcement) {
        this.enforcement = enforcement;
    }

    @GetMapping
    public List<Enforcement> list() {
        return enforcement.list();
    }

    @GetMapping("/{id}")
    public Enforcement get(@PathVariable long id) {
        return enforcement.get(id);
    }

    /** Manual revert by the administrator (removes the action's rules and meters). */
    @PostMapping("/{id}/revert")
    public Enforcement revert(@PathVariable long id, @RequestBody(required = false) RevertRequest body,
                              Principal principal) {
        String reason = body == null || body.reason() == null || body.reason().isBlank()
                ? "Manual revert by administrator" : "Manual revert: " + body.reason();
        return enforcement.rollback(id, EnforcementStatus.REVERTED, reason, principal.getName());
    }

    /** DEMO ONLY: makes the monitor see a regression so automatic rollback can be shown. */
    @PostMapping("/{id}/inject-regression")
    public Enforcement injectRegression(@PathVariable long id, Principal principal) {
        return enforcement.injectRegression(id, principal.getName());
    }
}
