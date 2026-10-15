package com.edgesdn.twin;

import com.edgesdn.agent.AgentModels.FlowResult;
import com.edgesdn.agent.AgentModels.ProbeResult;
import com.edgesdn.agent.AgentModels.TwinResult;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
public class KpiCalculator {

    public KpiSummary summarize(TwinResult r, String targetLinkId, Set<String> limitedClasses) {
        Map<String, Double> links = r.linkUtilization() == null ? Map.of() : r.linkUtilization();
        Double target = links.get(targetLinkId);

        Map<String, Double> classDelivered = new LinkedHashMap<>();
        Map<String, double[]> classLoss = new HashMap<>(); // [weighted sum, weight]
        double protOffered = 0;
        double protDelivered = 0;
        double lossWeighted = 0;
        double lossWeight = 0;
        for (FlowResult f : r.flows() == null ? List.<FlowResult>of() : r.flows()) {
            String tag = f.tag() == null ? "" : f.tag();
            double delivered = f.deliveredMbps() != null
                    ? f.deliveredMbps()
                    : (f.lossPct() != null ? f.offeredMbps() * (1 - f.lossPct() / 100.0) : 0.0);
            classDelivered.merge(tag, delivered, Double::sum);
            if (f.lossPct() != null) {
                double[] acc = classLoss.computeIfAbsent(tag, k -> new double[2]);
                acc[0] += f.offeredMbps() * f.lossPct();
                acc[1] += f.offeredMbps();
            }
            if (!limitedClasses.contains(tag)) {
                protOffered += f.offeredMbps();
                protDelivered += delivered;
                if (f.lossPct() != null) {
                    lossWeighted += f.offeredMbps() * f.lossPct();
                    lossWeight += f.offeredMbps();
                }
            }
        }
        Map<String, Double> classLossPct = new LinkedHashMap<>();
        classLoss.forEach((k, v) -> classLossPct.put(k, v[1] > 0 ? v[0] / v[1] : 0.0));

        double latSum = 0;
        int latN = 0;
        for (ProbeResult p : r.probes() == null ? List.<ProbeResult>of() : r.probes()) {
            if (p.avgRttMs() != null && !limitedClasses.contains(p.tag())) {
                latSum += p.avgRttMs();
                latN++;
            }
        }
        return new KpiSummary(target, r.maxLinkUtilization(),
                latN > 0 ? latSum / latN : null,
                lossWeight > 0 ? lossWeighted / lossWeight : null,
                protDelivered, protOffered, classDelivered, classLossPct, links,
                r.warnings() == null ? List.of() : r.warnings());
    }
}
