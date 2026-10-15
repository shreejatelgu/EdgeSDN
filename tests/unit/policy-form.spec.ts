import { expect, test } from '@playwright/test';
import type { PolicyConfig } from '../../frontend/src/app/core/models';
import { POLICY_NUMERIC_FIELDS, coercePolicy } from '../../frontend/src/app/core/policy-form';
import { defaultPolicy } from '../fixtures/mock-data';

test.describe('coercePolicy - policy form normalisation before PUT /api/policy', () => {
  test('POLICY_NUMERIC_FIELDS covers every numeric policy field (no field can be sent as a string)', () => {
    const numericKeys = Object.entries(defaultPolicy())
      .filter(([, v]) => typeof v === 'number').map(([k]) => k).sort();
    expect([...POLICY_NUMERIC_FIELDS].sort()).toEqual(numericKeys);
  });

  test('converts numeric strings from <input type="number"> to numbers', () => {
    const form = { ...defaultPolicy(), weightImprovement: '0.6', maxCandidates: '4', rollbackLossPct: '7.5' } as unknown as PolicyConfig;
    const out = coercePolicy(form);
    expect(out.weightImprovement).toBe(0.6);
    expect(out.maxCandidates).toBe(4);
    expect(out.rollbackLossPct).toBe(7.5);
  });

  test('empty or non-numeric values become null so the backend reports "must not be null" instead of storing 0', () => {
    const form = { ...defaultPolicy(), weightRisk: '', autoMinScore: 'abc', monitorWindowSec: undefined } as unknown as PolicyConfig;
    const out = coercePolicy(form);
    expect(out.weightRisk).toBeNull();
    expect(out.autoMinScore).toBeNull();
    expect(out.monitorWindowSec).toBeNull();
  });

  test('keeps legitimate zeros and negative scores', () => {
    const out = coercePolicy({ ...defaultPolicy(), weightConfidence: 0, autoMinScore: -0.2 });
    expect(out.weightConfidence).toBe(0);
    expect(out.autoMinScore).toBe(-0.2);
  });

  test('normalises the auto-approval action list to upper-case CSV without blanks', () => {
    expect(coercePolicy({ ...defaultPolicy(), autoAllowedActions: ' reroute , rate_limit ,, ' }).autoAllowedActions)
      .toBe('REROUTE,RATE_LIMIT');
    expect(coercePolicy({ ...defaultPolicy(), autoAllowedActions: '' }).autoAllowedActions).toBe('');
    expect(coercePolicy({ ...defaultPolicy(), autoAllowedActions: null as unknown as string }).autoAllowedActions).toBe('');
  });

  test('does not mutate the form model and keeps non-numeric fields', () => {
    const form = { ...defaultPolicy(), approvalMode: 'AUTO_LOW_RISK' as const, weightRisk: '0.4' as unknown as number };
    const snapshot = JSON.stringify(form);
    const out = coercePolicy(form);
    expect(JSON.stringify(form)).toBe(snapshot);
    expect(out.approvalMode).toBe('AUTO_LOW_RISK');
    expect(out.updatedBy).toBe(form.updatedBy);
  });
});
