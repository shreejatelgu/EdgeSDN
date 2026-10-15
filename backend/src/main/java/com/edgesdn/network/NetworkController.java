package com.edgesdn.network;

import com.edgesdn.agent.AgentClient;
import com.edgesdn.sdn.SdnControllerClient;
import com.edgesdn.topology.TopologyIndex;
import com.edgesdn.topology.TopologyModels.Topology;
import com.edgesdn.topology.TopologyService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.security.Principal;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
public class NetworkController {

    public record TopologyView(boolean loaded, String error, Topology topology) {
    }

    private final TopologyService topology;
    private final NetworkInitService init;
    private final SdnControllerClient controller;
    private final AgentClient agent;

    public NetworkController(TopologyService topology, NetworkInitService init, SdnControllerClient controller,
                             AgentClient agent) {
        this.topology = topology;
        this.init = init;
        this.controller = controller;
        this.agent = agent;
    }

    @GetMapping("/api/topology")
    public TopologyView topology() {
        return new TopologyView(topology.current().isPresent(), topology.lastError(),
                topology.current().map(TopologyIndex::topology).orElse(null));
    }

    @PostMapping("/api/topology/reload")
    public TopologyView reload() {
        topology.tryLoad();
        return topology();
    }

    @PostMapping("/api/network/init")
    public NetworkInitService.InitResult initialize(Principal principal) {
        return init.initialize(principal.getName());
    }

    @GetMapping("/api/network/status")
    public Map<String, Object> status() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("controller", controller.status());
        try {
            m.put("agent", agent.health());
        } catch (Exception e) {
            m.put("agent", Map.of("status", "DOWN", "error", String.valueOf(e.getMessage())));
        }
        try {
            m.put("liveTraffic", agent.liveTrafficStatus());
        } catch (Exception e) {
            m.put("liveTraffic", Map.of("error", String.valueOf(e.getMessage())));
        }
        m.put("lastInit", init.lastResult());
        return m;
    }
}
