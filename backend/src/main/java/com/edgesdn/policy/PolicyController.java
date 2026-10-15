package com.edgesdn.policy;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.security.Principal;

@RestController
@RequestMapping("/api/policy")
public class PolicyController {

    private final PolicyService policies;

    public PolicyController(PolicyService policies) {
        this.policies = policies;
    }

    @GetMapping
    public PolicyConfig get() {
        return policies.get();
    }

    @PutMapping
    public PolicyConfig update(@Valid @RequestBody PolicyUpdateRequest request, Principal principal) {
        return policies.update(request, principal.getName());
    }
}
