// Framework-free helpers of the "Network & demo" page (unit-tested).

/** Live demo load (Mbps per class). Every class crosses c1-d4, so the sum (33) exceeds its 30 Mbps capacity. */
export const EXAM_SURGE_PRESET: Readonly<Record<string, number>> = {
  EXAM_HALL: 12, LAB: 6, HOSTEL: 10, ADMIN: 2, LIBRARY: 3
};
export const DEFAULT_CLASS_DEMAND = 2;
export const DEFAULT_SCENARIO_LINK = 'c1-d4';

export function presetDemands(classes: string[], preset: Readonly<Record<string, number>> = EXAM_SURGE_PRESET):
  Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of classes) { out[c] = preset[c] ?? DEFAULT_CLASS_DEMAND; }
  return out;
}

/** Keeps only known classes with a finite demand > 0 (the backend rejects empty demand maps). */
export function positiveDemands(classes: string[], demands: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of classes) {
    const raw = demands[c];
    const v = raw === '' || raw === null || raw === undefined ? NaN : Number(raw);
    if (Number.isFinite(v) && v > 0) { out[c] = v; }
  }
  return out;
}

export interface ScenarioForm {
  linkId: string;
  predictedUtilization: unknown;
  confidence: unknown;
  horizonMinutes: unknown;
  durationMinutes: unknown;
  note: string;
}

export interface ScenarioRequestBody {
  linkId: string; horizonMinutes: number | null; predictedUtilization: number; confidence: number;
  durationMinutes: number; note: string;
}

/** Blank horizon means "all horizons" (null). */
export function scenarioRequest(sc: ScenarioForm): ScenarioRequestBody {
  const h = sc.horizonMinutes === null || sc.horizonMinutes === undefined || sc.horizonMinutes === ''
    ? null : Number(sc.horizonMinutes);
  return {
    linkId: sc.linkId,
    horizonMinutes: h !== null && Number.isFinite(h) ? h : null,
    predictedUtilization: Number(sc.predictedUtilization),
    confidence: Number(sc.confidence),
    durationMinutes: Number(sc.durationMinutes),
    note: sc.note
  };
}

export function defaultScenarioLink(links: string[]): string {
  return links.includes(DEFAULT_SCENARIO_LINK) ? DEFAULT_SCENARIO_LINK : (links[0] ?? '');
}
