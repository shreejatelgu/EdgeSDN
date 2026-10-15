// Mirrors of the Spring Boot JSON payloads.

export interface SwitchNode { name: string; dpid: number; role: 'CORE' | 'DISTRIBUTION' | 'ACCESS' | string; }
export interface HostNode { name: string; ip: string; mac: string; group: string; switchName: string; port: number; }
export interface LinkInfo { id: string; a: string; aPort: number; b: string; bPort: number; capacityMbps: number; }
export interface HostGroup {
  name: string; label: string; subnet: string; accessSwitch: string; priority: string;
  server: boolean; hosts: string[]; users: number;
}
export interface Topology { switches: SwitchNode[]; hosts: HostNode[]; links: LinkInfo[]; groups: HostGroup[]; }
export interface TopologyView { loaded: boolean; error: string | null; topology: Topology | null; }

export interface LinkView {
  id: string; a: string; b: string; capacityMbps: number;
  utilization: number | null; mbps: number | null;
  predictedPeak: number | null; peakHorizon: number | null; risk: number | null;
}
export interface GroupDemand { group: string; mbps: number; utilization: number; }
export interface LinkUtil { linkId: string; mbps: number; utilization: number; capacityMbps: number; }
export interface TelemetrySnapshot {
  polledAt: string | null; source: string; lastError: string | null; stale: boolean;
  links: LinkUtil[]; groups: GroupDemand[];
}
export interface TelemetrySample { id: number; subjectType: string; subjectId: string; ts: string; mbps: number; utilization: number; }

export interface Factor { name: string; value: number; contribution: number; description: string; }
export interface Counterfactual { description: string; predictedUtilization: number; }
export interface LinkForecast {
  linkId: string; horizonMinutes: number; predictedUtilization: number; lower: number; upper: number;
  congestionRisk: number; confidence: number; source: string; modelVersion: string;
  factors: Factor[]; counterfactuals: Counterfactual[];
}
export interface ForecastRun {
  runId: string; generatedAt: string; provider: string; fallbackUsed: boolean; fallbackReason: string | null;
  forecasts: LinkForecast[];
}

export type EventType = 'EXAM' | 'PLACEMENT' | 'FESTIVAL' | 'OTHER';
export interface InstitutionalEvent {
  id: number; name: string; type: EventType; startTime: string; endTime: string; durationMinutes: number;
  expectedIntensity: number; affectedGroups: string; description: string | null;
}
export interface EventRequest {
  name: string; type: EventType; startTime: string; durationMinutes: number; expectedIntensity: number;
  affectedGroups: string[]; description: string | null;
}

export type RecommendationStatus =
  'SIMULATING' | 'PENDING_APPROVAL' | 'APPROVED' | 'AUTO_APPROVED' | 'REJECTED' | 'EXPIRED' |
  'NO_ACTION_RECOMMENDED' | 'APPLYING' | 'MONITORING' | 'VERIFIED' | 'ROLLED_BACK' | 'REVERTED' | 'FAILED';

export interface Recommendation {
  id: number; createdAt: string; updatedAt: string; status: RecommendationStatus;
  targetLinkId: string; horizonMinutes: number; predictedUtilization: number; congestionRisk: number;
  confidence: number; predictionSource: string; predictionRunId: string; factualExplanation: string;
  predictionFactorsJson: string | null; predictionCounterfactualsJson: string | null;
  baselineKpiJson: string | null; classDemandJson: string | null; weightsJson: string | null;
  selectedCandidateId: number | null; alternativeCandidateId: number | null;
  whySelected: string | null; whyNotAlternative: string | null; counterfactual: string | null; humanImpact: string | null;
  approvalMode: string | null; autoApprovalNote: string | null; expiresAt: string | null;
  decidedBy: string | null; decidedAt: string | null; decisionComment: string | null; approvedCandidateId: number | null;
  enforcementId: number | null; failureReason: string | null;
}
export interface RecommendationCandidate {
  id: number; recommendationId: number; rankNo: number; actionType: 'REROUTE' | 'RATE_LIMIT';
  trafficClass: string; description: string; pathJson: string | null; baselinePathJson: string | null;
  rateKbps: number | null; flowsJson: string | null; metersJson: string | null; twinKpiJson: string | null;
  rawImprovement: number; kpiImprovement: number; risk: number; confidence: number; score: number;
  improvementBreakdownJson: string | null; riskBreakdownJson: string | null;
  status: 'SELECTABLE' | 'NO_GAIN' | 'SIMULATION_FAILED'; note: string | null;
}
export interface RecommendationView { recommendation: Recommendation; candidates: RecommendationCandidate[]; }

export interface KpiSummary {
  targetLinkUtil: number | null; maxLinkUtil: number; protectedLatencyMs: number | null; protectedLossPct: number | null;
  protectedDeliveredMbps: number; protectedOfferedMbps: number;
  classDeliveredMbps: Record<string, number>; classLossPct: Record<string, number>;
  linkUtilization: Record<string, number>; warnings: string[];
}
export interface LiveKpi {
  at: string; targetLinkUtil: number | null; maxLinkUtil: number | null; avgLatencyMs: number | null;
  avgProbeLossPct: number | null; warnings: string[];
}

export type EnforcementStatus = 'APPLYING' | 'MONITORING' | 'VERIFIED' | 'ROLLED_BACK' | 'REVERTED' | 'FAILED';
export interface Enforcement {
  id: number; recommendationId: number; candidateId: number; trafficClass: string; actionType: string;
  targetLinkId: string; pathJson: string | null; flowsJson: string | null; metersJson: string | null;
  preSnapshotJson: string | null; baselineKpiJson: string | null; lastKpiJson: string | null;
  status: EnforcementStatus; startedAt: string; monitorUntil: string | null; endedAt: string | null;
  endReason: string | null; appliedBy: string; samplesTaken: number; consecutiveRegressions: number;
  lastRegression: string | null; regressionInjected: boolean;
}

export type ApprovalMode = 'MANUAL' | 'AUTO_LOW_RISK';
export interface PolicyConfig {
  approvalMode: ApprovalMode;
  weightImprovement: number; weightConfidence: number; weightRisk: number;
  congestionUtilThreshold: number; congestionRiskThreshold: number;
  minImprovement: number; maxCandidates: number; rateLimitFraction: number;
  autoMaxRisk: number; autoMinScore: number; autoMinConfidence: number; autoAllowedActions: string; autoMaxPerHour: number;
  recommendationTtlMinutes: number; monitorWindowSec: number;
  rollbackUtilIncreasePct: number; rollbackLatencyIncreasePct: number; rollbackLossPct: number;
  updatedAt?: string; updatedBy?: string;
}

export interface AuditEvent {
  id: number; ts: string; actor: string; type: string; recommendationId: number | null; enforcementId: number | null;
  summary: string; details: string | null; prevHash: string; hash: string;
}
export interface PageResponse<T> { content: T[]; page: number; size: number; totalElements: number; totalPages: number; }
export interface VerifyResult { valid: boolean; checked: number; firstBrokenId: number | null; message: string; }

export interface DashboardView {
  topologyLoaded: boolean; topologyError: string | null; topology: Topology | null; links: LinkView[];
  groups: GroupDemand[]; telemetryAt: string | null; telemetryStale: boolean; telemetryError: string | null;
  provider: string; forecastAt: string | null; openRecommendations: Recommendation[];
  activeEnforcements: Enforcement[]; approvalMode: ApprovalMode;
}

export interface ScenarioOverride {
  id: string; linkId: string; horizonMinutes: number | null; predictedUtilization: number; confidence: number;
  expiresAt: string; note: string; createdBy: string;
}

export interface Me { username: string; roles: string[]; }
