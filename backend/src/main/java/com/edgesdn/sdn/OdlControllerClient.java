package com.edgesdn.sdn;

import com.edgesdn.agent.AgentModels.PortCounters;
import com.edgesdn.common.Exceptions.ExternalServiceException;
import com.edgesdn.config.EdgeProperties;
import com.edgesdn.routing.FlowMatch;
import com.edgesdn.routing.FlowSpec;
import com.edgesdn.routing.MeterSpec;
import com.edgesdn.topology.TopologyIndex;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * OpenDaylight RESTCONF (RFC 8040, "/rests/data") client using the OpenFlowPlugin inventory model.
 * Only the config datastore is written; OpenFlowPlugin pushes those rules to the switches.
 */
@Component
public class OdlControllerClient implements SdnControllerClient {

    private static final String NODES = "/opendaylight-inventory:nodes";

    private final RestClient rest;
    private final EdgeProperties props;
    private final ObjectMapper mapper;

    public OdlControllerClient(@Qualifier("odlRestClient") RestClient rest, EdgeProperties props, ObjectMapper mapper) {
        this.rest = rest;
        this.props = props;
        this.mapper = mapper;
    }

    // ------------------------------------------------------------------ URLs

    private String base() {
        String b = props.getOdl().getBaseUrl();
        String d = props.getOdl().getDataPath();
        return (b.endsWith("/") ? b.substring(0, b.length() - 1) : b) + (d.startsWith("/") ? d : "/" + d);
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    private String nodeUrl(TopologyIndex t, String sw) {
        return base() + NODES + "/node=" + enc(t.odlNodeId(sw));
    }

    private String tableUrl(TopologyIndex t, String sw, int table) {
        return nodeUrl(t, sw) + "/flow-node-inventory:table=" + table;
    }

    private String flowUrl(TopologyIndex t, String sw, int table, String flowId) {
        return tableUrl(t, sw, table) + "/flow=" + enc(flowId);
    }

    private String meterUrl(TopologyIndex t, String sw, long meterId) {
        return nodeUrl(t, sw) + "/flow-node-inventory:meter=" + meterId;
    }

    // ------------------------------------------------------------------ writes

    @Override
    public void installFlow(TopologyIndex t, FlowSpec f) {
        ObjectNode body = mapper.createObjectNode();
        body.putArray("flow-node-inventory:flow").add(flowJson(t, f));
        put(flowUrl(t, f.switchName(), f.table(), f.id()), body, "install flow " + f.id());
    }

    @Override
    public void removeFlow(TopologyIndex t, String sw, int table, String flowId) {
        delete(flowUrl(t, sw, table, flowId), "remove flow " + flowId);
    }

    @Override
    public void installMeter(TopologyIndex t, MeterSpec m) {
        ObjectNode meter = mapper.createObjectNode();
        meter.put("meter-id", m.meterId());
        meter.put("meter-name", "edge-meter-" + m.meterId());
        meter.put("flags", "meter-kbps meter-burst");
        ObjectNode band = meter.putObject("meter-band-headers").putArray("meter-band-header").addObject();
        band.put("band-id", 0);
        band.put("drop-rate", m.rateKbps());
        band.put("drop-burst-size", Math.max(1, m.burstKb()));
        band.putObject("meter-band-types").put("flags", "ofpmbt-drop");
        ObjectNode body = mapper.createObjectNode();
        body.putArray("flow-node-inventory:meter").add(meter);
        put(meterUrl(t, m.switchName(), m.meterId()), body, "install meter " + m.meterId());
    }

    @Override
    public void removeMeter(TopologyIndex t, String sw, long meterId) {
        delete(meterUrl(t, sw, meterId), "remove meter " + meterId);
    }

    @Override
    public void replaceTable(TopologyIndex t, String sw, int table, List<FlowSpec> flows) {
        ObjectNode tableNode = mapper.createObjectNode();
        tableNode.put("id", table);
        ArrayNode arr = tableNode.putArray("flow");
        for (FlowSpec f : flows) {
            arr.add(flowJson(t, f));
        }
        ObjectNode body = mapper.createObjectNode();
        body.putArray("flow-node-inventory:table").add(tableNode);
        put(tableUrl(t, sw, table), body, "replace table " + table + " on " + sw);
    }

    private ObjectNode flowJson(TopologyIndex t, FlowSpec f) {
        ObjectNode flow = mapper.createObjectNode();
        flow.put("id", f.id());
        flow.put("table_id", f.table());
        flow.put("priority", f.priority());
        flow.put("flow-name", f.id());
        flow.put("idle-timeout", 0);
        flow.put("hard-timeout", 0);

        ObjectNode match = flow.putObject("match");
        FlowMatch m = f.match() == null ? FlowMatch.any() : f.match();
        Integer ethType = m.ethType();
        if (ethType == null && (m.ipv4Src() != null || m.ipv4Dst() != null)) {
            ethType = 0x0800; // prerequisite for IPv4 matches
        }
        if (ethType != null) {
            match.putObject("ethernet-match").putObject("ethernet-type").put("type", ethType);
        }
        if (m.ipv4Src() != null) {
            match.put("ipv4-source", m.ipv4Src());
        }
        if (m.ipv4Dst() != null) {
            match.put("ipv4-destination", m.ipv4Dst());
        }
        if (m.inPort() != null) {
            match.put("in-port", t.odlNodeId(f.switchName()) + ":" + m.inPort());
        }

        ArrayNode instructions = flow.putObject("instructions").putArray("instruction");
        int order = 0;
        if (f.meterId() != null) {
            ObjectNode ins = instructions.addObject();
            ins.put("order", order++);
            ins.putObject("meter").put("meter-id", f.meterId());
        }
        if (f.outputPort() != null) {
            ObjectNode ins = instructions.addObject();
            ins.put("order", order++);
            ObjectNode action = ins.putObject("apply-actions").putArray("action").addObject();
            action.put("order", 0);
            ObjectNode out = action.putObject("output-action");
            out.put("output-node-connector", String.valueOf(f.outputPort()));
            out.put("max-length", 65535);
        }
        if (f.gotoTable() != null) {
            ObjectNode ins = instructions.addObject();
            ins.put("order", order);
            ins.putObject("go-to-table").put("table_id", f.gotoTable());
        }
        return flow;
    }

    // ------------------------------------------------------------------ reads

    @Override
    public String readTableConfig(TopologyIndex t, String sw, int table) {
        try {
            String body = rest.get().uri(URI.create(tableUrl(t, sw, table) + "?content=config"))
                    .retrieve().body(String.class);
            return body == null ? "{}" : body;
        } catch (RestClientResponseException e) {
            if (e.getStatusCode().value() == HttpStatus.NOT_FOUND.value()) {
                return "{}";
            }
            throw wrap("read table " + table + " on " + sw, e);
        } catch (RestClientException e) {
            throw wrap("read table " + table + " on " + sw, e);
        }
    }

    @Override
    public Map<String, Map<Integer, PortCounters>> fetchPortStats(TopologyIndex t) {
        String json;
        try {
            json = rest.get().uri(URI.create(base() + NODES + "?content=nonconfig")).retrieve().body(String.class);
        } catch (RestClientException e) {
            throw wrap("fetch port statistics", e);
        }
        Map<String, Map<Integer, PortCounters>> out = new HashMap<>();
        for (JsonNode node : nodeArray(json)) {
            String nodeId = node.path("id").asText("");
            Long dpid = parseDpid(nodeId);
            if (dpid == null) {
                continue;
            }
            var sw = t.switchByDpid(dpid);
            if (sw.isEmpty()) {
                continue;
            }
            Map<Integer, PortCounters> ports = new HashMap<>();
            for (JsonNode conn : node.path("node-connector")) {
                String connId = conn.path("id").asText("");
                int idx = connId.lastIndexOf(':');
                if (idx < 0) {
                    continue;
                }
                int port;
                try {
                    port = Integer.parseInt(connId.substring(idx + 1));
                } catch (NumberFormatException e) {
                    continue; // LOCAL
                }
                JsonNode stats = conn.path("opendaylight-port-statistics:flow-capable-node-connector-statistics");
                if (stats.isMissingNode()) {
                    stats = conn.path("flow-capable-node-connector-statistics");
                }
                JsonNode bytes = stats.path("bytes");
                if (bytes.isMissingNode()) {
                    continue;
                }
                // RFC 8040 encodes uint64 as JSON strings; asLong() parses both forms.
                ports.put(port, new PortCounters(bytes.path("received").asLong(0), bytes.path("transmitted").asLong(0)));
            }
            out.put(sw.get().name(), ports);
        }
        return out;
    }

    @Override
    public ControllerStatus status() {
        try {
            String json = rest.get().uri(URI.create(base() + NODES + "?content=nonconfig&depth=3"))
                    .retrieve().body(String.class);
            int count = 0;
            for (JsonNode ignored : nodeArray(json)) {
                count++;
            }
            return new ControllerStatus(true, count, "OpenDaylight reachable");
        } catch (RestClientResponseException e) {
            if (e.getStatusCode().value() == HttpStatus.NOT_FOUND.value()) {
                return new ControllerStatus(true, 0, "OpenDaylight reachable, no switches connected");
            }
            return new ControllerStatus(false, 0, "HTTP " + e.getStatusCode().value() + ": " + e.getStatusText());
        } catch (Exception e) {
            return new ControllerStatus(false, 0, e.getMessage());
        }
    }

    private Iterable<JsonNode> nodeArray(String json) {
        try {
            JsonNode root = mapper.readTree(json == null ? "{}" : json);
            JsonNode nodes = root.path("opendaylight-inventory:nodes");
            if (nodes.isMissingNode()) {
                nodes = root.path("nodes");
            }
            JsonNode arr = nodes.path("node");
            return arr.isArray() ? arr : List.of();
        } catch (Exception e) {
            throw new ExternalServiceException("OpenDaylight returned unparsable JSON: " + e.getMessage());
        }
    }

    private static Long parseDpid(String nodeId) {
        if (!nodeId.startsWith("openflow:")) {
            return null;
        }
        try {
            return Long.parseUnsignedLong(nodeId.substring("openflow:".length()));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    // ------------------------------------------------------------------ http helpers

    private void put(String url, JsonNode body, String what) {
        try {
            rest.put().uri(URI.create(url)).contentType(MediaType.APPLICATION_JSON).body(body.toString())
                    .retrieve().toBodilessEntity();
        } catch (RestClientException e) {
            throw wrap(what, e);
        }
    }

    private void delete(String url, String what) {
        try {
            rest.delete().uri(URI.create(url)).retrieve().toBodilessEntity();
        } catch (RestClientResponseException e) {
            int code = e.getStatusCode().value();
            if (code == 404 || code == 409) {
                return; // already absent (RFC 8040 returns 409 "data-missing" on some releases)
            }
            throw wrap(what, e);
        } catch (RestClientException e) {
            throw wrap(what, e);
        }
    }

    private static ExternalServiceException wrap(String what, RestClientException e) {
        if (e instanceof RestClientResponseException r) {
            return new ExternalServiceException("OpenDaylight " + what + " failed: HTTP " + r.getStatusCode().value()
                    + " " + r.getResponseBodyAsString());
        }
        return new ExternalServiceException("OpenDaylight unreachable (" + what + "): " + e.getMessage(), e);
    }
}
