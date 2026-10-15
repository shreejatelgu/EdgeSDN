package com.edgesdn.audit;

import com.edgesdn.common.PageResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/audit")
public class AuditController {

    private final AuditService audit;

    public AuditController(AuditService audit) {
        this.audit = audit;
    }

    @GetMapping
    public PageResponse<AuditEvent> search(@RequestParam(required = false) AuditType type,
                                           @RequestParam(required = false) Long recommendationId,
                                           @RequestParam(defaultValue = "0") int page,
                                           @RequestParam(defaultValue = "50") int size) {
        return PageResponse.of(audit.search(type, recommendationId, page, size));
    }

    @GetMapping("/verify")
    public AuditService.VerifyResult verify() {
        return audit.verify();
    }
}
