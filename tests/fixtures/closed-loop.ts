import { expect } from '@playwright/test';
import type { PolicyConfig, Recommendation } from '../../frontend/src/app/core/models';
import { EdgeApi, expectStatus } from './api';

/** Link that carries every traffic class in the baseline routing (the designed bottleneck). */
export const BOTTLENECK = 'c1-d4';
/** Terminal pipeline outcomes (the twin has finished). */
export const DECIDABLE = ['PENDING_APPROVAL', 'NO_ACTION_RECOMMENDED', 'FAILED', 'AUTO_APPROVED', 'APPLYING',
  'MONITORING', 'VERIFIED', 'ROLLED_BACK'];

/**
 * Brings the live network back to a known state: no demo scenarios or live load, no active actions,
 * no pending recommendations, no pipeline running, baseline routing re-programmed.
 */
export async function resetClosedLoop(api: EdgeApi): Promise<void> {
  await expectStatus(await api.clearScenarios(), 204);
  await api.stopLiveTraffic();
  // A running pipeline cannot be cancelled: wait for it to finish first.
  await expect.poll(async () => (await api.recommendations('SIMULATING')).length,
    { timeout: 240_000, intervals: [3_000], message: 'a twin simulation is still running' }).toBe(0);
  for (const r of await api.recommendations('PENDING_APPROVAL')) {
    await api.reject(r.id, 'automated test reset');
  }
  for (const e of await api.enforcements()) {
    if (e.status === 'MONITORING' || e.status === 'VERIFIED') {
      await api.revert(e.id, 'automated test reset');
    }
  }
  await expectStatus(await api.initNetwork(), 200);
}

export async function maxRecommendationId(api: EdgeApi): Promise<number> {
  return (await api.recommendations()).reduce((m, r) => Math.max(m, r.id), 0);
}

/**
 * Injects a labelled demo forecast of 95 % on the bottleneck, evaluates, and waits for the NEW
 * recommendation to leave SIMULATING. Returns it (any decidable status: the caller asserts which).
 */
export async function triggerCongestion(api: EdgeApi, note = 'automated test congestion'): Promise<Recommendation> {
  const before = await maxRecommendationId(api);
  await expectStatus(await api.addScenario({
    linkId: BOTTLENECK, horizonMinutes: null, predictedUtilization: 0.95, confidence: 0.9, durationMinutes: 20, note
  }), 201);
  await expectStatus(await api.evaluate(), 200);
  let rec: Recommendation | undefined;
  await expect.poll(async () => {
    rec = (await api.recommendations()).find(r => r.id > before && r.targetLinkId === BOTTLENECK);
    return rec?.status ?? 'not created yet';
  }, { timeout: 300_000, intervals: [3_000], message: 'recommendation pipeline did not finish' })
    .toMatch(new RegExp(`^(${DECIDABLE.join('|')})$`));
  return rec!;
}

export async function waitForStatus(api: EdgeApi, recId: number, pattern: RegExp, timeout = 120_000): Promise<string> {
  let status = '';
  await expect.poll(async () => (status = (await api.recommendation(recId)).recommendation.status),
    { timeout, intervals: [2_000], message: `recommendation ${recId} did not reach ${pattern}` }).toMatch(pattern);
  return status;
}

/** Runs `body` with a policy patch applied and always restores the previous policy. */
export async function withPolicy<T>(api: EdgeApi, patch: Partial<PolicyConfig>, body: () => Promise<T>): Promise<T> {
  const original = await api.policy();
  await api.updatePolicy(patch);
  try {
    return await body();
  } finally {
    await expectStatus(await api.putPolicy(original), 200);
  }
}
