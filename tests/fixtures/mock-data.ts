// Deterministic fixture data for the mocked UI suites and unit tests. The topology is built exactly like
// twin-agent/agent/topology.py (same ports, addresses and link ids), so it matches the real system.
import type {
  AuditEvent, DashboardView, Enforcement, ForecastRun, HostGroup, HostNode, InstitutionalEvent, KpiSummary, LinkInfo,
  LinkView, Me, PolicyConfig, Recommendation, RecommendationCandidate, RecommendationView, ScenarioOverride,
  TelemetrySample, TelemetrySnapshot, Topology
} from '../../frontend/src/app/core/models';

const SWITCHES: [string, string, number][] = [
  ['c1', 'CORE', 1], ['c2', 'CORE', 2],
  ['d1', 'DISTRIBUTION', 11], ['d2', 'DISTRIBUTION', 12], ['d3', 'DISTRIBUTION', 13], ['d4', 'DISTRIBUTION', 14],
  ['a1', 'ACCESS', 21], ['a2', 'ACCESS', 22], ['a3', 'ACCESS', 23], ['a4', 'ACCESS', 24], ['a5', 'ACCESS', 25], ['a6', 'ACCESS', 26]
];
const LINKS: [string, string, number][] = [
  ['c1', 'c2', 50],
  ['c1', 'd1', 30], ['c2', 'd1', 30], ['c1', 'd2', 30], ['c2', 'd2', 30],
  ['c1', 'd3', 30], ['c2', 'd3', 30], ['c1', 'd4', 30], ['c2', 'd4', 30],
  ['d1', 'a1', 20], ['d1', 'a2', 20], ['d2', 'a3', 20], ['d2', 'a4', 20], ['d3', 'a5', 20], ['d4', 'a6', 50]
];
const GROUPS = [
  { name: 'EXAM_HALL', label: 'Examination Hall', gid: 1, sw: 'a1', hosts: 4, priority: 'HIGH', users: 300, server: false },
  { name: 'LAB', label: 'Computer Labs', gid: 2, sw: 'a2', hosts: 3, priority: 'MEDIUM', users: 180, server: false },
  { name: 'HOSTEL', label: 'Hostel Wi-Fi', gid: 3, sw: 'a3', hosts: 3, priority: 'LOW', users: 600, server: false },
  { name: 'ADMIN', label: 'Administration', gid: 4, sw: 'a4', hosts: 2, priority: 'HIGH', users: 60, server: false },
  { name: 'LIBRARY', label: 'Library', gid: 5, sw: 'a5', hosts: 2, priority: 'MEDIUM', users: 120, server: false },
  { name: 'SERVERS', label: 'Server Farm', gid: 10, sw: 'a6', hosts: 2, priority: 'HIGH', users: 0, server: true }
];

export const linkId = (a: string, b: string) => [a, b].sort().join('-');

export function buildTopology(): Topology {
  const ports: Record<string, number> = {};
  const nextPort = (sw: string) => (ports[sw] = (ports[sw] ?? 0) + 1);
  const links: LinkInfo[] = LINKS.map(([a, b, capacityMbps]) => {
    const aPort = nextPort(a);
    const bPort = nextPort(b);
    return { id: linkId(a, b), a, aPort, b, bPort, capacityMbps };
  });
  const hosts: HostNode[] = [];
  const groups: HostGroup[] = [];
  for (const g of GROUPS) {
    const names: string[] = [];
    for (let i = 1; i <= g.hosts; i++) {
      const name = `h${g.gid}n${i}`;
      hosts.push({
        name, ip: `10.0.${g.gid}.${i}`,
        mac: `00:00:00:00:${g.gid.toString(16).padStart(2, '0')}:${i.toString(16).padStart(2, '0')}`,
        group: g.name, switchName: g.sw, port: nextPort(g.sw)
      });
      names.push(name);
    }
    groups.push({
      name: g.name, label: g.label, subnet: `10.0.${g.gid}.0/24`, accessSwitch: g.sw, priority: g.priority,
      server: g.server, hosts: names, users: g.users
    });
  }
  return { switches: SWITCHES.map(([name, role, dpid]) => ({ name, role, dpid })), hosts, links, groups };
}

const iso = (offsetMinutes: number) => new Date(Date.now() + offsetMinutes * 60_000).toISOString();
const round3 = (v: number) => Math.round(v * 1000) / 1000;
export const WEIGHTS = { improvement: 0.5, confidence: 0.2, risk: 0.3 };
export const scoreOf = (kpi: number, conf: number, risk: number) =>
  round3(WEIGHTS.improvement * kpi + WEIGHTS.confidence * conf - WEIGHTS.risk * risk);

/** Current utilisation per link (null = no telemetry yet). Unlisted links: 0.12. */
export const LINK_UTIL: Record<string, number | null> = {
  'c1-d4': 0.93, 'c1-d1': 0.62, 'c1-d2': 0.41, 'c1-c2': 0.05, 'c2-d3': null
};
/** Predicted peak [utilisation, horizon, risk] per link. Unlisted links: current utilisation. */
export const LINK_PRED: Record<string, [number, number, number]> = {
  'c1-d4': [0.97, 30, 0.99], 'c1-d1': [0.71, 30, 0.08]
};

function linkViews(t: Topology): LinkView[] {
  return t.links.map(l => {
    const u = l.id in LINK_UTIL ? LINK_UTIL[l.id] : 0.12;
    const p = LINK_PRED[l.id];
    return {
      id: l.id, a: l.a, b: l.b, capacityMbps: l.capacityMbps,
      utilization: u, mbps: u === null ? null : round3(u * l.capacityMbps),
      predictedPeak: p ? p[0] : u, peakHorizon: p ? p[1] : (u === null ? null : 15), risk: p ? p[2] : (u === null ? null : 0.01)
    };
  });
}

function kpi(target: number, max: number, lat: number, loss: number, delivered: number,
             classDelivered: Record<string, number>): KpiSummary {
  return {
    targetLinkUtil: target, maxLinkUtil: max, protectedLatencyMs: lat, protectedLossPct: loss,
    protectedDeliveredMbps: delivered, protectedOfferedMbps: 28.5, classDeliveredMbps: classDelivered,
    classLossPct: {}, linkUtilization: { 'c1-d4': target }, warnings: []
  };
}

export const BASELINE_KPI = kpi(0.98, 0.98, 45.2, 12.4, 24.9, { EXAM_HALL: 10.1, LAB: 4.9, HOSTEL: 8.2, ADMIN: 1.9, LIBRARY: 2.8 });
export const SELECTED_KPI = kpi(0.61, 0.66, 12.4, 0.8, 28.2, { EXAM_HALL: 11.9, LAB: 5.9, HOSTEL: 9.8, ADMIN: 2, LIBRARY: 3 });
export const ALTERNATIVE_KPI = kpi(0.74, 0.74, 20.3, 2.1, 19.6, { EXAM_HALL: 11.8, LAB: 5.8, HOSTEL: 6, ADMIN: 2, LIBRARY: 3 });

function candidate(id: number, recId: number, rank: number, type: 'REROUTE' | 'RATE_LIMIT', cls: string,
                   description: string, status: RecommendationCandidate['status'], k: number, risk: number,
                   twin: KpiSummary | null, note: string | null = null): RecommendationCandidate {
  return {
    id, recommendationId: recId, rankNo: rank, actionType: type, trafficClass: cls, description,
    pathJson: JSON.stringify(['a6', 'd4', 'c2', 'd1', 'a1']), baselinePathJson: JSON.stringify(['a6', 'd4', 'c1', 'd1', 'a1']),
    rateKbps: type === 'RATE_LIMIT' ? 6000 : null,
    flowsJson: '[]', metersJson: '[]', twinKpiJson: twin ? JSON.stringify(twin) : null,
    rawImprovement: k, kpiImprovement: Math.max(0, k), risk, confidence: 0.82,
    score: status === 'SIMULATION_FAILED' ? -1 : scoreOf(Math.max(0, k), 0.82, risk),
    improvementBreakdownJson: JSON.stringify({ targetLinkUtilGain: 0.378, maxLinkUtilGain: 0.327, latencyGain: 0.726, lossGain: 0.935 }),
    riskBreakdownJson: JSON.stringify({ disruption: 0.353, pathStretch: 0, coreTouch: 0.25, lossSpike: 0, priorityImpact: 0.1 }),
    status, note
  };
}

export const FACTORS = [
  { name: 'recentBaseline', value: 0.62, contribution: 0.62, description: 'Smoothed recent utilisation is 62% (18 samples)' },
  { name: 'trend', value: 0.0013, contribution: 0.04, description: 'Recent trend +0.13 pp/min projected over 30 min gives +4 pp' },
  { name: 'event:Semester Examination', value: 0.85, contribution: 0.31,
    description: "EXAM 'Semester Examination' (intensity 0.85 x type factor 0.7 x activity 1.00 x share 0.20 of groups on link) adds +31 pp" }
];
export const PREDICTION_COUNTERFACTUALS = [
  { description: "Without event 'Semester Examination' the prediction would be 66% (below the 80% threshold)", predictedUtilization: 0.66 },
  { description: 'Load must fall by 18 percentage points for the link to leave the congestion zone', predictedUtilization: 0.79 }
];

export function recommendationView(id: number, status: Recommendation['status'],
                                   opts: { alternativeId?: number | null; withCandidates?: boolean } = {}): RecommendationView {
  const withCandidates = opts.withCandidates ?? status !== 'SIMULATING';
  const candidates = withCandidates ? [
    candidate(id * 10 + 1, id, 1, 'REROUTE', 'EXAM_HALL',
      'Reroute Server Farm -> Examination Hall traffic via a6 > d4 > c2 > d1 > a1', 'SELECTABLE', 0.72, 0.187, SELECTED_KPI),
    candidate(id * 10 + 2, id, 2, 'RATE_LIMIT', 'HOSTEL',
      'Rate-limit Server Farm -> Hostel Wi-Fi traffic to 6.0 Mbps (60% of predicted 10.0 Mbps) at a6', 'SELECTABLE', 0.58, 0.41, ALTERNATIVE_KPI),
    candidate(id * 10 + 3, id, 3, 'REROUTE', 'LAB',
      'Reroute Server Farm -> Computer Labs traffic via a6 > d4 > c2 > d1 > a2', 'SIMULATION_FAILED', 0, 0, null,
      'Twin agent twin simulation failed: HTTP 500 ovs-ofctl add-flows failed')
  ] : [];
  const selected = candidates[0] ?? null;
  const alternativeId = opts.alternativeId === undefined ? (candidates[1]?.id ?? null) : opts.alternativeId;
  const recommendation: Recommendation = {
    id, createdAt: iso(-3), updatedAt: iso(-2), status,
    targetLinkId: 'c1-d4', horizonMinutes: 30, predictedUtilization: 0.97, congestionRisk: 0.99, confidence: 0.82,
    predictionSource: 'RULE_BASED', predictionRunId: 'run-mock-1',
    factualExplanation: 'Link c1-d4 is predicted to reach 97% in 30 min (range 85%-100%, confidence 82%, congestion risk 0.99, source RULE_BASED).',
    predictionFactorsJson: JSON.stringify(FACTORS),
    predictionCounterfactualsJson: JSON.stringify(PREDICTION_COUNTERFACTUALS),
    baselineKpiJson: withCandidates ? JSON.stringify(BASELINE_KPI) : null,
    classDemandJson: JSON.stringify({ EXAM_HALL: 12, LAB: 6, HOSTEL: 10, ADMIN: 2, LIBRARY: 3 }),
    weightsJson: JSON.stringify(WEIGHTS),
    selectedCandidateId: status === 'NO_ACTION_RECOMMENDED' ? null : selected?.id ?? null,
    alternativeCandidateId: status === 'NO_ACTION_RECOMMENDED' ? null : alternativeId,
    whySelected: status === 'NO_ACTION_RECOMMENDED'
      ? 'No candidate improved KPIs by more than 0.050 in the digital twin, so no action is recommended.'
      : withCandidates ? `Selected: ${selected!.description}. Score ${selected!.score.toFixed(3)} = 0.50 x KPIImprovement 0.720 + 0.20 x Confidence 0.820 - 0.30 x Risk 0.187.` : null,
    whyNotAlternative: withCandidates ? 'Alternative scored lower. Main reason: its weighted risk was 0.067 higher (0.410 vs 0.187; largest risk factor: priorityImpact 0.20).' : null,
    counterfactual: withCandidates ? 'If the alternative\'s risk were below 0.121 (it is 0.410), it would have been selected.' : null,
    humanImpact: withCandidates
      ? 'Without action, link c1-d4 is expected to be about 97% loaded in ~30 minutes, mainly because of the event \'Semester Examination\'.\nDownloads from the Server Farm to Examination Hall (~300 users) will take the alternate path a6 > d4 > c2 > d1 > a1.'
      : null,
    approvalMode: 'MANUAL', autoApprovalNote: status === 'PENDING_APPROVAL' ? 'Manual approval mode: an administrator decision is required.' : null,
    expiresAt: iso(12), decidedBy: null, decidedAt: null, decisionComment: null, approvedCandidateId: null,
    enforcementId: null, failureReason: null
  };
  return { recommendation, candidates };
}

function audit(id: number, recId: number | null, type: string, actor: string, summary: string, minutesAgo: number): AuditEvent {
  return {
    id, ts: iso(-minutesAgo), actor, type, recommendationId: recId, enforcementId: null, summary,
    details: null, prevHash: id === 1 ? 'GENESIS' : `hash${id - 1}`.padEnd(64, '0'), hash: `hash${id}`.padEnd(64, '0')
  };
}

function enforcement(id: number, recId: number, status: Enforcement['status'], extra: Partial<Enforcement> = {}): Enforcement {
  return {
    id, recommendationId: recId, candidateId: recId * 10 + 1, trafficClass: 'HOSTEL', actionType: 'REROUTE',
    targetLinkId: 'c1-d4', pathJson: '["a6","d4","c2","d2","a3"]', flowsJson: '[]', metersJson: '[]', preSnapshotJson: '{}',
    baselineKpiJson: JSON.stringify({ at: iso(-10), targetLinkUtil: 0.95, maxLinkUtil: 0.95, avgLatencyMs: 40.1, avgProbeLossPct: 3, warnings: [] }),
    lastKpiJson: JSON.stringify({ at: iso(-1), targetLinkUtil: 0.7, maxLinkUtil: 0.7, avgLatencyMs: 14.2, avgProbeLossPct: 0, warnings: [] }),
    status, startedAt: iso(-10), monitorUntil: status === 'MONITORING' ? iso(2) : iso(-7), endedAt: null, endReason: null,
    appliedBy: 'admin', samplesTaken: 4, consecutiveRegressions: 0, lastRegression: null, regressionInjected: false, ...extra
  };
}

export function defaultPolicy(): PolicyConfig {
  return {
    approvalMode: 'MANUAL', weightImprovement: 0.5, weightConfidence: 0.2, weightRisk: 0.3,
    congestionUtilThreshold: 0.8, congestionRiskThreshold: 0.5, minImprovement: 0.05, maxCandidates: 3,
    rateLimitFraction: 0.6, autoMaxRisk: 0.25, autoMinScore: 0.35, autoMinConfidence: 0.6, autoAllowedActions: 'REROUTE',
    autoMaxPerHour: 3, recommendationTtlMinutes: 15, monitorWindowSec: 180, rollbackUtilIncreasePct: 15,
    rollbackLatencyIncreasePct: 50, rollbackLossPct: 5, updatedAt: iso(-60), updatedBy: 'SYSTEM:default'
  };
}

function forecastRun(): ForecastRun {
  const f = (linkIdValue: string, h: number, p: number, risk: number) => ({
    linkId: linkIdValue, horizonMinutes: h, predictedUtilization: p, lower: Math.max(0, p - 0.12), upper: Math.min(1.5, p + 0.12),
    congestionRisk: risk, confidence: 0.82, source: 'RULE_BASED', modelVersion: 'rule-v1',
    factors: linkIdValue === 'c1-d4' ? FACTORS : [FACTORS[0]],
    counterfactuals: linkIdValue === 'c1-d4' ? PREDICTION_COUNTERFACTUALS : []
  });
  return {
    runId: 'run-mock-1', generatedAt: iso(-1), provider: 'RULE_BASED', fallbackUsed: false, fallbackReason: null,
    forecasts: [f('c1-d4', 15, 0.88, 0.93), f('c1-d4', 30, 0.97, 0.99), f('c1-d4', 60, 0.93, 0.98),
      f('c1-d1', 15, 0.55, 0.01), f('c1-d1', 30, 0.62, 0.01), f('c1-d1', 60, 0.58, 0.01)]
  };
}

export interface MockState {
  me: Me;
  topology: Topology;
  topologyLoaded: boolean;
  topologyError: string | null;
  telemetryStale: boolean;
  links: LinkView[];
  recommendations: RecommendationView[];
  enforcements: Enforcement[];
  audit: AuditEvent[];
  forecast: ForecastRun | null;
  mlStatus: Record<string, unknown>;
  telemetry: TelemetrySnapshot;
  history: Record<string, TelemetrySample[]>;
  networkStatus: Record<string, unknown>;
  scenarios: ScenarioOverride[];
  policy: PolicyConfig;
  events: InstitutionalEvent[];
}

export const OPEN_STATUSES = ['SIMULATING', 'PENDING_APPROVAL', 'APPROVED', 'AUTO_APPROVED', 'APPLYING', 'MONITORING'];

export function mockData(): MockState {
  const topology = buildTopology();
  const links = linkViews(topology);
  const rec40 = recommendationView(40, 'MONITORING');
  rec40.recommendation.decidedBy = 'admin';
  rec40.recommendation.enforcementId = 7;
  return {
    me: { username: 'admin', roles: ['ROLE_ADMIN'] },
    topology, topologyLoaded: true, topologyError: null, telemetryStale: false, links,
    recommendations: [recommendationView(42, 'PENDING_APPROVAL'), rec40, recommendationView(38, 'VERIFIED'),
      recommendationView(44, 'NO_ACTION_RECOMMENDED', { withCandidates: false })],
    enforcements: [
      enforcement(7, 40, 'MONITORING'),
      enforcement(6, 38, 'VERIFIED'),
      enforcement(5, 36, 'ROLLED_BACK', { endReason: 'Automatic rollback: busiest-link utilisation rose 70% -> 96% (limit 81%)', endedAt: iso(-20) }),
      enforcement(4, 34, 'REVERTED', { endReason: 'Manual revert by administrator', endedAt: iso(-40) })
    ],
    audit: [
      audit(5, 42, 'RECOMMENDATION_READY', 'SYSTEM', 'Recommendation ready: Reroute Server Farm -> Examination Hall', 2),
      audit(4, 42, 'TWIN_SIMULATED', 'SYSTEM:twin', 'Twin: Reroute Server Farm -> Examination Hall -> score 0.469', 2),
      audit(3, 42, 'TWIN_SIMULATED', 'SYSTEM:twin', 'Twin baseline: c1-d4 at 98%, busiest link 98%', 3),
      audit(2, 42, 'RECOMMENDATION_CREATED', 'SYSTEM', 'Action required: c1-d4 predicted at 97% in 30 min', 3),
      audit(1, null, 'SYSTEM_STARTED', 'SYSTEM', 'EDGE-SDN backend started', 90)
    ],
    forecast: forecastRun(),
    mlStatus: {
      activeProvider: 'RULE_BASED', availableProviders: ['ML', 'RULE_BASED'], mlBaseUrl: 'http://localhost:8001',
      fallbackToRuleBased: true, reachable: false, error: 'ML service unreachable (health): Connection refused'
    },
    telemetry: {
      polledAt: iso(0), source: 'ODL', lastError: null, stale: false,
      links: links.filter(l => l.utilization !== null).map(l => ({
        linkId: l.id, mbps: l.mbps ?? 0, utilization: l.utilization ?? 0, capacityMbps: l.capacityMbps
      })),
      groups: [{ group: 'EXAM_HALL', mbps: 10.1, utilization: 0.5 }, { group: 'HOSTEL', mbps: 8.2, utilization: 0.41 }]
    },
    history: {
      'c1-d4': Array.from({ length: 10 }, (_, i) => ({
        id: i + 1, subjectType: 'LINK', subjectId: 'c1-d4', ts: iso(i - 10), mbps: 18 + i, utilization: round3((18 + i) / 30)
      }))
    },
    networkStatus: {
      controller: { reachable: true, connectedSwitches: 12, message: 'OpenDaylight reachable' },
      agent: { status: 'UP', live: true, twin: true, datapath: 'kernel' },
      liveTraffic: { running: false, streams: 0, offeredMbps: 0, remainingSec: 0 },
      lastInit: null
    },
    scenarios: [],
    policy: defaultPolicy(),
    events: [{
      id: 1, name: 'Semester Examination (online portal)', type: 'EXAM', startTime: iso(20), endTime: iso(200),
      durationMinutes: 180, expectedIntensity: 0.85, affectedGroups: 'EXAM_HALL',
      description: 'Synthetic sample event: end-semester online examination'
    }]
  };
}

export function dashboardOf(s: MockState): DashboardView {
  return {
    topologyLoaded: s.topologyLoaded, topologyError: s.topologyError, topology: s.topologyLoaded ? s.topology : null,
    links: s.topologyLoaded ? s.links : [], groups: s.telemetry.groups, telemetryAt: s.telemetry.polledAt,
    telemetryStale: s.telemetryStale, telemetryError: s.telemetryStale ? 'no poll for 5 minutes' : null,
    provider: 'RULE_BASED', forecastAt: s.forecast?.generatedAt ?? null,
    openRecommendations: s.recommendations.map(v => v.recommendation).filter(r => OPEN_STATUSES.includes(r.status)),
    activeEnforcements: s.enforcements.filter(e => ['APPLYING', 'MONITORING', 'VERIFIED'].includes(e.status)),
    approvalMode: s.policy.approvalMode
  };
}
