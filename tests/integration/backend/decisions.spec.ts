import { expectStatus } from '../../fixtures/api';
import { BOTTLENECK, resetClosedLoop, triggerCongestion } from '../../fixtures/closed-loop';
import { expect, requireBackend, requireNetwork, test } from '../../fixtures/fixtures';

test.describe('Prediction, recommendation and enforcement APIs - contract and negative paths', () => {
  test.beforeEach(({ stack }) => requireBackend(stack));

  test('recommendation list: at most 100, newest first, well-formed', async ({ viewerApi }) => {
    const list = await viewerApi.recommendations();
    expect(list.length).toBeLessThanOrEqual(100);
    const ids = list.map(r => r.id);
    expect([...ids].sort((a, b) => b - a)).toEqual(ids);
    for (const r of list) {
      expect(r.targetLinkId).toBeTruthy();
      expect(r.predictedUtilization).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  test('status filter returns only matching recommendations', async ({ viewerApi }) => {
    for (const status of ['PENDING_APPROVAL', 'VERIFIED', 'ROLLED_BACK']) {
      for (const r of await viewerApi.recommendations(status)) { expect(r.status).toBe(status); }
    }
  });

  test('unknown recommendation: read, approve and reject -> 404', async ({ adminApi }) => {
    await expectStatus(await adminApi.ctx.get('/api/recommendations/999999999'), 404);
    await expectStatus(await adminApi.approve(999999999), 404);
    await expectStatus(await adminApi.reject(999999999, 'x'), 404);
  });

  test('approve / reject without a body are accepted as "recommended candidate / no reason"', async ({ adminApi }) => {
    // Still 404 for an unknown id - proves the optional body is not a 400.
    await expectStatus(await adminApi.ctx.post('/api/recommendations/999999999/approve'), 404);
    await expectStatus(await adminApi.ctx.post('/api/recommendations/999999999/reject'), 404);
  });

  test('a recommendation that is not pending cannot be decided again (409)', async ({ adminApi }) => {
    const decided = (await adminApi.recommendations()).find(r =>
      ['REJECTED', 'EXPIRED', 'VERIFIED', 'ROLLED_BACK', 'REVERTED', 'NO_ACTION_RECOMMENDED'].includes(r.status));
    test.skip(!decided, 'no decided recommendation exists yet (run the closed-loop suites first)');
    const res = await adminApi.approve(decided!.id);
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toContain('not PENDING_APPROVAL');
    expect((await adminApi.reject(decided!.id)).status()).toBe(409);
  });

  test('enforcements: list, unknown id -> 404 for read, revert and inject', async ({ adminApi }) => {
    const list = await adminApi.enforcements();
    expect(Array.isArray(list)).toBe(true);
    await expectStatus(await adminApi.ctx.get('/api/enforcements/999999999'), 404);
    await expectStatus(await adminApi.revert(999999999), 404);
    await expectStatus(await adminApi.injectRegression(999999999), 404);
  });

  test('an enforcement that is no longer active cannot be reverted again (409)', async ({ adminApi }) => {
    const done = (await adminApi.enforcements()).find(e => ['ROLLED_BACK', 'REVERTED', 'FAILED'].includes(e.status));
    test.skip(!done, 'no finished enforcement exists yet');
    expect((await adminApi.revert(done!.id)).status()).toBe(409);
    expect((await adminApi.injectRegression(done!.id)).status()).toBe(409);
  });

  test('latest forecast: 204 before the first run, otherwise a well-formed run', async ({ viewerApi }) => {
    const res = await viewerApi.latestForecast();
    expect([200, 204]).toContain(res.status());
    if (res.status() === 200) {
      const run = await res.json();
      expect(run.runId).toBeTruthy();
      for (const f of run.forecasts) {
        expect([15, 30, 60]).toContain(f.horizonMinutes);
        expect(f.congestionRisk).toBeGreaterThanOrEqual(0);
        expect(f.congestionRisk).toBeLessThanOrEqual(1);
        expect(f.confidence).toBeGreaterThanOrEqual(0);
        expect(f.confidence).toBeLessThanOrEqual(1);
        expect(f.lower).toBeLessThanOrEqual(f.predictedUtilization);
        expect(f.upper).toBeGreaterThanOrEqual(f.predictedUtilization);
      }
    }
  });

  test('prediction history returns a list', async ({ viewerApi }) => {
    const rows = await viewerApi.ok<any[]>(viewerApi.ctx.get('/api/predictions/history', { params: { linkId: BOTTLENECK, minutes: 30 } }));
    expect(Array.isArray(rows)).toBe(true);
  });

  test('scenarios: list, delete unknown -> 404, clear -> 204', async ({ adminApi }) => {
    expect(Array.isArray(await adminApi.scenarios())).toBe(true);
    await expectStatus(await adminApi.ctx.delete('/api/scenarios/does-not-exist'), 404);
    await expectStatus(await adminApi.clearScenarios(), 204);
    expect(await adminApi.scenarios()).toEqual([]);
  });

  test('scenario validation: utilisation above 1.5 or unknown link -> 400', async ({ adminApi, stack }) => {
    const tooHigh = await adminApi.addScenario({ linkId: BOTTLENECK, horizonMinutes: null, predictedUtilization: 2, confidence: 0.5, durationMinutes: 5, note: 't' });
    expect(tooHigh.status()).toBe(400);
    test.skip(!stack.topologyLoaded, 'link validation needs the topology');
    const unknown = await adminApi.addScenario({ linkId: 'zz-zz', horizonMinutes: null, predictedUtilization: 0.9, confidence: 0.5, durationMinutes: 5, note: 't' });
    expect(unknown.status()).toBe(400);
  });

  test('live traffic: unknown class or empty demands -> 400', async ({ adminApi, stack }) => {
    expect((await adminApi.startLiveTraffic({}, 60)).status()).toBe(400);
    test.skip(!stack.topologyLoaded, 'class validation needs the topology');
    expect((await adminApi.startLiveTraffic({ MARS_BASE: 5 }, 60)).status()).toBe(400);
  });
});

test.describe('Recommendation pipeline on the live network (twin-agent + OpenDaylight)', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(({ stack }) => requireNetwork(stack));
  test.afterEach(async ({ adminApi }) => { await adminApi.clearScenarios(); });

  test('demo scenario overrides are applied and labelled in the forecast', async ({ adminApi }) => {
    await expectStatus(await adminApi.clearScenarios(), 204);
    await expectStatus(await adminApi.addScenario({
      linkId: BOTTLENECK, horizonMinutes: 30, predictedUtilization: 0.95, confidence: 0.9, durationMinutes: 5, note: 'integration'
    }), 201);
    const run = await adminApi.runForecastOk();
    const f = run.forecasts.find(x => x.linkId === BOTTLENECK && x.horizonMinutes === 30)!;
    expect(f.predictedUtilization).toBeCloseTo(0.95, 5);
    expect(f.source).toContain('+SCENARIO');
    expect(f.factors[0].name).toBe('scenario-override');
    expect(f.factors[0].description).toContain('DEMO SCENARIO');
    expect(f.counterfactuals[0].description).toContain('Without the injected demo scenario');
    const other = run.forecasts.find(x => x.linkId === BOTTLENECK && x.horizonMinutes === 15)!;
    expect(other.source).not.toContain('+SCENARIO');
  });

  test('pipeline produces a twin-validated, explained and transparently scored recommendation', async ({ adminApi }) => {
    await resetClosedLoop(adminApi);
    const rec = await triggerCongestion(adminApi, 'integration pipeline');
    expect(['PENDING_APPROVAL', 'NO_ACTION_RECOMMENDED']).toContain(rec.status);
    const { recommendation: r, candidates } = await adminApi.recommendation(rec.id);
    expect(r.factualExplanation).toContain(BOTTLENECK);
    expect(JSON.parse(r.baselineKpiJson!)).toHaveProperty('maxLinkUtil');
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(5);
    // ranks are 1..n, selectable candidates first, by descending score
    expect(candidates.map(c => c.rankNo)).toEqual(candidates.map((_, i) => i + 1));
    const selectable = candidates.filter(c => c.status === 'SELECTABLE');
    expect(selectable.map(c => c.score)).toEqual([...selectable.map(c => c.score)].sort((a, b) => b - a));
    const weights = JSON.parse(r.weightsJson!);
    for (const c of selectable) {
      // Score = w1*KPIImprovement + w2*Confidence - w3*Risk (4-decimal rounding in the backend)
      const expected = weights.improvement * c.kpiImprovement + weights.confidence * c.confidence - weights.risk * c.risk;
      expect(c.score).toBeCloseTo(expected, 3);
      expect(c.kpiImprovement).toBeGreaterThanOrEqual(0);
      expect(c.kpiImprovement).toBeLessThanOrEqual(1);
      expect(c.risk).toBeGreaterThanOrEqual(0);
      expect(c.risk).toBeLessThanOrEqual(1);
      expect(c.rawImprovement).toBeGreaterThan(0);
      expect(JSON.parse(c.twinKpiJson!)).toHaveProperty('targetLinkUtil');
    }
    if (r.status === 'PENDING_APPROVAL') {
      expect(r.selectedCandidateId).toBe(selectable[0].id);
      expect(r.whySelected).toContain('Score');
      expect(r.whyNotAlternative).toBeTruthy();
      expect(r.counterfactual).toBeTruthy();
      expect(r.humanImpact).toContain(BOTTLENECK);
      expect(r.expiresAt).toBeTruthy();
      await expectStatus(await adminApi.reject(r.id, 'integration test clean-up'), 200);
    } else {
      expect(r.whySelected).toContain('No candidate');
    }
    const auditTypes = (await adminApi.audit({ recommendationId: rec.id, size: 100 })).content.map(a => a.type);
    expect(auditTypes).toEqual(expect.arrayContaining(['RECOMMENDATION_CREATED', 'TWIN_SIMULATED']));
  });

  test('a SIMULATION_FAILED or NO_GAIN candidate cannot be approved (400)', async ({ adminApi }) => {
    await resetClosedLoop(adminApi);
    const rec = await triggerCongestion(adminApi, 'integration ineligible');
    test.skip(rec.status !== 'PENDING_APPROVAL', `pipeline ended in ${rec.status}`);
    const { candidates } = await adminApi.recommendation(rec.id);
    const ineligible = candidates.find(c => c.status !== 'SELECTABLE');
    test.skip(!ineligible, 'every candidate was selectable in this run');
    const res = await adminApi.approve(rec.id, ineligible!.id);
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toContain('cannot be applied');
    await adminApi.reject(rec.id, 'integration test clean-up');
  });
});
