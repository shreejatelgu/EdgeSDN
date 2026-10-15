import type { PolicyConfig } from '../../../frontend/src/app/core/models';
import { EdgeApi, apiContext, expectStatus } from '../../fixtures/api';
import { expect, requireBackend, test } from '../../fixtures/fixtures';

// Policy is global state: run serially and always restore the original values.
test.describe.configure({ mode: 'serial' });

test.describe('Administrator policy API (scoring weights, approval mode, rollback limits)', () => {
  let original: PolicyConfig;

  test.beforeAll(async () => {
    const ctx = await apiContext('admin');
    original = await new EdgeApi(ctx).policy();
    await ctx.dispose();
  });

  test.afterAll(async () => {
    const ctx = await apiContext('admin');
    await expectStatus(await new EdgeApi(ctx).putPolicy(original), 200);
    await ctx.dispose();
  });

  test.beforeEach(({ stack }) => requireBackend(stack));

  test('returns every tunable parameter within its documented range', async ({ adminApi }) => {
    const p = await adminApi.policy();
    expect(['MANUAL', 'AUTO_LOW_RISK']).toContain(p.approvalMode);
    for (const w of [p.weightImprovement, p.weightConfidence, p.weightRisk]) {
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
    expect(p.weightImprovement + p.weightConfidence + p.weightRisk).toBeGreaterThan(0);
    expect(p.maxCandidates).toBeGreaterThanOrEqual(1);
    expect(p.maxCandidates).toBeLessThanOrEqual(5);
    expect(p.monitorWindowSec).toBeGreaterThanOrEqual(30);
    expect(typeof p.autoAllowedActions).toBe('string');
  });

  test('a valid update is persisted and attributed to the administrator', async ({ adminApi }) => {
    const updated = await adminApi.updatePolicy({
      approvalMode: 'AUTO_LOW_RISK', weightImprovement: 0.6, weightConfidence: 0.1, weightRisk: 0.3, autoMaxRisk: 0.2
    });
    expect(updated).toMatchObject({ approvalMode: 'AUTO_LOW_RISK', weightImprovement: 0.6, weightConfidence: 0.1, autoMaxRisk: 0.2 });
    expect(updated.updatedBy).toBe('admin');
    const again = await adminApi.policy();
    expect(again).toMatchObject({ approvalMode: 'AUTO_LOW_RISK', weightImprovement: 0.6 });
  });

  test('every policy change is audited with before and after values', async ({ adminApi }) => {
    const before = await adminApi.policy();
    const newRisk = before.weightRisk === 0.3 ? 0.35 : 0.3;
    await adminApi.updatePolicy({ weightRisk: newRisk });
    const entry = (await adminApi.audit({ type: 'POLICY_UPDATED', size: 1 })).content[0];
    expect(entry.actor).toBe('admin');
    const details = JSON.parse(entry.details ?? '{}');
    expect(details.before.weights.risk).toBe(before.weightRisk);
    expect(details.after.weights.risk).toBe(newRisk);
  });

  test('auto-approval action list is normalised to upper-case CSV', async ({ adminApi }) => {
    const p = await adminApi.updatePolicy({ autoAllowedActions: ' reroute, rate_limit ,REROUTE' });
    expect(p.autoAllowedActions).toBe('REROUTE,RATE_LIMIT');
  });

  test('unknown action type in the auto-approval list -> 400', async ({ adminApi }) => {
    const res = await adminApi.putPolicy({ ...(await adminApi.policy()), autoAllowedActions: 'REROUTE,SHUTDOWN_SWITCH' });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toContain('Unknown action type in autoAllowedActions: SHUTDOWN_SWITCH');
  });

  test('all score weights zero -> 400 (the score would be meaningless)', async ({ adminApi }) => {
    const res = await adminApi.putPolicy({ ...(await adminApi.policy()), weightImprovement: 0, weightConfidence: 0, weightRisk: 0 });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toBe('At least one score weight must be > 0');
  });

  const outOfRange: [keyof PolicyConfig | string, unknown][] = [
    ['weightRisk', 1.5], ['weightImprovement', -0.1], ['congestionUtilThreshold', 0.05], ['congestionRiskThreshold', 1.2],
    ['maxCandidates', 6], ['maxCandidates', 0], ['rateLimitFraction', 0.99], ['autoMinScore', -1.5],
    ['recommendationTtlMinutes', 0], ['monitorWindowSec', 10], ['rollbackLossPct', 0], ['autoMaxPerHour', 61],
    ['approvalMode', null], ['weightConfidence', null]
  ];
  for (const [field, value] of outOfRange) {
    test(`${String(field)} = ${JSON.stringify(value)} -> 400 and nothing changes`, async ({ adminApi }) => {
      const before = await adminApi.policy();
      const res = await adminApi.putPolicy({ ...before, [field]: value });
      expect(res.status()).toBe(400);
      expect((await res.json()).message).toContain(String(field));
      const after = await adminApi.policy();
      expect(after.updatedAt).toBe(before.updatedAt);
    });
  }

  test('invalid approval mode value -> 400', async ({ adminApi }) => {
    const res = await adminApi.putPolicy({ ...(await adminApi.policy()), approvalMode: 'FULLY_AUTONOMOUS' });
    expect(res.status()).toBe(400);
  });
});
