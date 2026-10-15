// Framework-free normalisation of the policy form before PUT /api/policy (unit-tested).
import type { PolicyConfig } from './models';

/** Every numeric field of PolicyConfig. Inputs of type="number" can still yield strings or "". */
export const POLICY_NUMERIC_FIELDS = [
  'weightImprovement', 'weightConfidence', 'weightRisk',
  'congestionUtilThreshold', 'congestionRiskThreshold',
  'minImprovement', 'maxCandidates', 'rateLimitFraction',
  'autoMaxRisk', 'autoMinScore', 'autoMinConfidence', 'autoMaxPerHour',
  'recommendationTtlMinutes', 'monitorWindowSec',
  'rollbackUtilIncreasePct', 'rollbackLatencyIncreasePct', 'rollbackLossPct'
] as const;

/**
 * Returns a copy with numeric fields converted to numbers. Empty or non-numeric values become null so the
 * backend rejects them explicitly ("must not be null") instead of silently storing 0.
 * autoAllowedActions is normalised to upper-case CSV without blanks.
 */
export function coercePolicy(p: PolicyConfig): PolicyConfig {
  const out: Record<string, unknown> = { ...p };
  for (const k of POLICY_NUMERIC_FIELDS) {
    const v = out[k];
    const n = v === '' || v === null || v === undefined ? NaN : Number(v);
    out[k] = Number.isFinite(n) ? n : null;
  }
  out['autoAllowedActions'] = String(p.autoAllowedActions ?? '')
    .split(',').map(s => s.trim().toUpperCase()).filter(s => s.length > 0).join(',');
  return out as unknown as PolicyConfig;
}
