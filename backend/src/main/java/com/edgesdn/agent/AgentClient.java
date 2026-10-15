package com.edgesdn.agent;

import com.edgesdn.agent.AgentModels.LiveProbeRequest;
import com.edgesdn.agent.AgentModels.LiveProbeResponse;
import com.edgesdn.agent.AgentModels.LiveTrafficRequest;
import com.edgesdn.agent.AgentModels.PortCounters;
import com.edgesdn.agent.AgentModels.PortStatsResponse;
import com.edgesdn.agent.AgentModels.ProbePair;
import com.edgesdn.agent.AgentModels.ProbeResult;
import com.edgesdn.agent.AgentModels.TwinRequest;
import com.edgesdn.agent.AgentModels.TwinResult;
import com.edgesdn.common.Exceptions.ExternalServiceException;
import com.edgesdn.topology.TopologyModels.Topology;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/** HTTP client for the Python twin-agent (live Mininet network + digital twin). */
@Component
public class AgentClient {

    private final RestClient rest;

    public AgentClient(@Qualifier("agentRestClient") RestClient rest) {
        this.rest = rest;
    }

    public Map<String, Object> health() {
        return call("health", () -> rest.get().uri("/health").retrieve()
                .body(new ParameterizedTypeReference<Map<String, Object>>() {
                }));
    }

    public Topology fetchTopology() {
        Topology t = call("fetch topology", () -> rest.get().uri("/topology").retrieve().body(Topology.class));
        if (t == null) {
            throw new ExternalServiceException("Twin agent returned an empty topology");
        }
        return t;
    }

    /** switch name -> port number -> counters, read from the live network's interfaces. */
    public Map<String, Map<Integer, PortCounters>> livePortStats() {
        PortStatsResponse r = call("live port stats",
                () -> rest.get().uri("/live/port-stats").retrieve().body(PortStatsResponse.class));
        Map<String, Map<Integer, PortCounters>> out = new HashMap<>();
        if (r == null || r.switches() == null) {
            return out;
        }
        r.switches().forEach((sw, ports) -> {
            Map<Integer, PortCounters> m = new HashMap<>();
            ports.forEach((p, c) -> {
                try {
                    m.put(Integer.parseInt(p), c);
                } catch (NumberFormatException ignored) {
                    // LOCAL or non-numeric ports are not used
                }
            });
            out.put(sw, m);
        });
        return out;
    }

    public TwinResult simulate(TwinRequest request) {
        TwinResult r = call("twin simulation", () -> rest.post().uri("/twin/simulate")
                .contentType(MediaType.APPLICATION_JSON).body(request).retrieve().body(TwinResult.class));
        if (r == null) {
            throw new ExternalServiceException("Twin agent returned an empty simulation result");
        }
        return r;
    }

    public List<ProbeResult> liveProbe(List<ProbePair> pairs, int count) {
        LiveProbeResponse r = call("live probe", () -> rest.post().uri("/live/probe")
                .contentType(MediaType.APPLICATION_JSON).body(new LiveProbeRequest(pairs, count))
                .retrieve().body(LiveProbeResponse.class));
        return r == null || r.probes() == null ? List.of() : r.probes();
    }

    public Map<String, Object> startLiveTraffic(LiveTrafficRequest request) {
        return call("start live traffic", () -> rest.post().uri("/live/traffic/start")
                .contentType(MediaType.APPLICATION_JSON).body(request).retrieve()
                .body(new ParameterizedTypeReference<Map<String, Object>>() {
                }));
    }

    public Map<String, Object> stopLiveTraffic() {
        return call("stop live traffic", () -> rest.post().uri("/live/traffic/stop").retrieve()
                .body(new ParameterizedTypeReference<Map<String, Object>>() {
                }));
    }

    public Map<String, Object> liveTrafficStatus() {
        return call("live traffic status", () -> rest.get().uri("/live/traffic").retrieve()
                .body(new ParameterizedTypeReference<Map<String, Object>>() {
                }));
    }

    private static <T> T call(String what, Supplier<T> s) {
        try {
            return s.get();
        } catch (RestClientResponseException e) {
            throw new ExternalServiceException("Twin agent " + what + " failed: HTTP " + e.getStatusCode().value()
                    + " " + e.getResponseBodyAsString());
        } catch (RestClientException e) {
            throw new ExternalServiceException("Twin agent unreachable (" + what + "): " + e.getMessage(), e);
        }
    }
}
