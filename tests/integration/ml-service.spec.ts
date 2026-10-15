import { request, type APIRequestContext } from '@playwright/test';
import { ENV } from '../fixtures/env';
import { expect, test } from '../fixtures/fixtures';

/**
 * Contract of the Python ML service (the endpoints the backend's MlClient calls).
 * Validates the placeholder today and the LSTM + SHAP/LIME implementation later - the contract is the same.
 * Skipped when the service is unreachable; EDGE_REQUIRE_ML=1 turns that into a failure.
 */
let ml: APIRequestContext;
let available = false;

test.beforeAll(async () => {
  const headers: Record<string, string> = ENV.mlApiKey ? { 'X-Api-Key': ENV.mlApiKey } : {};
  ml = await request.newContext({ baseURL: ENV.mlUrl, extraHTTPHeaders: headers, timeout: 30_000 });
  const res = await ml.get('/api/v1/health', { timeout: 5_000 }).catch(() => null);
  available = !!res && res.ok();
});

test.afterAll(async () => { await ml?.dispose(); });

test.beforeEach(() => {
  const reason = `ML service not reachable at ${ENV.mlUrl} (SETUP_GUIDE section 14)`;
  if (ENV.requireMl) { expect(available, reason).toBe(true); } else { test.skip(!available, reason); }
});

const now = Date.now();
const iso = (offsetMin: number) => new Date(now + offsetMin * 60_000).toISOString();

/** Same shape as the backend's PredictionInput. */
function predictionInput(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: iso(0),
    horizonsMinutes: [15, 30, 60],
    congestionThreshold: 0.8,
    links: [
      { linkId: 'c1-d4', capacityMbps: 30, groups: ['EXAM_HALL', 'LAB', 'HOSTEL', 'ADMIN', 'LIBRARY'],
        history: Array.from({ length: 12 }, (_, i) => ({ ts: iso(i - 12), utilization: 0.5 + i * 0.02 })) },
      { linkId: 'a1-d1', capacityMbps: 20, groups: ['EXAM_HALL'], history: [] }
    ],
    events: [{ id: 1, name: 'Semester Examination', type: 'EXAM', startTime: iso(20), durationMinutes: 180,
      expectedIntensity: 0.85, affectedGroups: ['EXAM_HALL'] }],
    ...overrides
  };
}

test.describe('ML service contract', () => {
  test('GET /api/v1/health -> UP with a model version', async () => {
    const h = await (await ml.get('/api/v1/health')).json();
    expect(h.status).toBe('UP');
    expect(typeof h.modelVersion).toBe('string');
  });

  test('GET /api/v1/model-info describes the model honestly', async () => {
    const info = await (await ml.get('/api/v1/model-info')).json();
    expect(info).toHaveProperty('modelVersion');
    expect(typeof info.isTrainedModel).toBe('boolean');
    if (String(info.modelVersion).startsWith('placeholder')) { expect(info.isTrainedModel).toBe(false); }
  });

  test('POST /api/v1/predict returns one forecast per link and horizon, all values in range', async () => {
    const res = await ml.post('/api/v1/predict', { data: predictionInput() });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.modelVersion).toBe('string');
    expect(body.predictions).toHaveLength(2 * 3);
    const keys = new Set(body.predictions.map((p: any) => `${p.linkId}@${p.horizonMinutes}`));
    for (const link of ['c1-d4', 'a1-d1']) {
      for (const h of [15, 30, 60]) { expect(keys.has(`${link}@${h}`), `${link}@${h}`).toBe(true); }
    }
    for (const p of body.predictions) {
      expect(p.predictedUtilization).toBeGreaterThanOrEqual(0);
      expect(p.congestionRisk).toBeGreaterThanOrEqual(0);
      expect(p.congestionRisk).toBeLessThanOrEqual(1);
      expect(p.confidence).toBeGreaterThanOrEqual(0);
      expect(p.confidence).toBeLessThanOrEqual(1);
      if (p.lower != null) { expect(p.lower).toBeLessThanOrEqual(p.predictedUtilization); }
      if (p.upper != null) { expect(p.upper).toBeGreaterThanOrEqual(p.predictedUtilization); }
      expect(p.explanation).toBeTruthy();
      expect(typeof p.explanation.method).toBe('string');
      expect(Array.isArray(p.explanation.factors)).toBe(true);
      expect(Array.isArray(p.counterfactuals)).toBe(true);
    }
  });

  test('predict with a link without history still answers (cold start)', async () => {
    const res = await ml.post('/api/v1/predict', { data: predictionInput({ events: [] }) });
    expect(res.status()).toBe(200);
    const cold = (await res.json()).predictions.find((p: any) => p.linkId === 'a1-d1');
    expect(cold).toBeTruthy();
  });

  const invalid: [string, Record<string, unknown>][] = [
    ['missing links', { links: undefined }],
    ['missing horizons', { horizonsMinutes: undefined }],
    ['event intensity above 1', { events: [{ name: 'x', type: 'EXAM', startTime: iso(5), durationMinutes: 10, expectedIntensity: 2 }] }],
    ['non-numeric utilisation', { links: [{ linkId: 'c1-d4', capacityMbps: 30, history: [{ ts: iso(-1), utilization: 'high' }] }] }]
  ];
  for (const [label, patch] of invalid) {
    test(`predict rejects ${label} with 422`, async () => {
      const body = JSON.parse(JSON.stringify(predictionInput(patch)));
      expect((await ml.post('/api/v1/predict', { data: body })).status()).toBe(422);
    });
  }

  test('POST /api/v1/explain returns an explanation for the requested link', async () => {
    const res = await ml.post('/api/v1/explain', { data: { input: predictionInput(), linkId: 'c1-d4', horizonMinutes: 30, method: 'SHAP' } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ linkId: 'c1-d4', horizonMinutes: 30 });
    expect(typeof body.explanation.method).toBe('string');
  });

  test('POST /api/v1/counterfactual returns a list of counterfactuals', async () => {
    const res = await ml.post('/api/v1/counterfactual', {
      data: { input: predictionInput(), linkId: 'c1-d4', horizonMinutes: 30, targetUtilization: 0.7, maxChanges: 2 }
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.counterfactuals)).toBe(true);
    for (const c of body.counterfactuals) { expect(typeof c.description).toBe('string'); }
  });

  test('API key is enforced when configured', async () => {
    test.skip(!ENV.mlApiKey, 'EDGE_ML_API_KEY not set for this run');
    const anon = await request.newContext({ baseURL: ENV.mlUrl });
    try {
      expect((await anon.post('/api/v1/predict', { data: predictionInput() })).status()).toBe(401);
      expect((await anon.get('/api/v1/health')).status()).toBe(200);
    } finally {
      await anon.dispose();
    }
  });
});
