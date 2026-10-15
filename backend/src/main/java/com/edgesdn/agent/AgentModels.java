package com.edgesdn.agent;

import com.edgesdn.routing.FlowSpec;
import com.edgesdn.routing.MeterSpec;

import java.util.List;
import java.util.Map;

/** Request/response bodies of the twin-agent REST API (see twin-agent/agent/models.py). */
public final class AgentModels {

    private AgentModels() {
    }

    public record PortCounters(long rxBytes, long txBytes) {
    }

    /** switches: switch name -> (port number as string -> counters). */
    public record PortStatsResponse(double timestamp, Map<String, Map<String, PortCounters>> switches) {
    }

    /** One UDP stream (iperf) from src host to dst host; tag = traffic class id. */
    public record TrafficFlow(String tag, String src, String dst, double rateMbps) {
    }

    /** One ping probe; tag = traffic class id. */
    public record ProbePair(String tag, String src, String dst) {
    }

    public record TwinRequest(List<FlowSpec> flows, List<MeterSpec> meters, List<TrafficFlow> traffic,
                              List<ProbePair> probes, int durationSec) {
    }

    public record FlowResult(String tag, String src, String dst, double offeredMbps, Double deliveredMbps,
                             Double lossPct) {
    }

    public record ProbeResult(String tag, String src, String dst, Double avgRttMs, Double lossPct) {
    }

    public record TwinResult(Map<String, Double> linkUtilization, double maxLinkUtilization,
                             List<FlowResult> flows, List<ProbeResult> probes, List<String> warnings,
                             double measuredSec) {
    }

    public record LiveProbeRequest(List<ProbePair> pairs, int count) {
    }

    public record LiveProbeResponse(List<ProbeResult> probes) {
    }

    public record LiveTrafficRequest(List<TrafficFlow> traffic, int durationSec) {
    }
}
