import { apiContext } from '../../fixtures/api';
import { ENV } from '../../fixtures/env';
import { expect, requireBackend, test } from '../../fixtures/fixtures';

test.describe('Backend security: authentication and role-based access', () => {
  test.beforeEach(({ stack }) => requireBackend(stack));

  test('liveness endpoint is public', async ({ anonApi }) => {
    const res = await anonApi.ctx.get('/api/system/ping');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: 'UP' });
  });

  const protectedGets = ['/api/system/health', '/api/dashboard', '/api/events', '/api/policy', '/api/audit',
    '/api/recommendations', '/api/enforcements', '/api/telemetry/latest', '/api/topology', '/api/ml/status',
    '/api/predictions/latest', '/api/scenarios', '/api/network/status', '/api/audit/verify'];
  for (const path of protectedGets) {
    test(`anonymous GET ${path} -> 401 JSON without a browser login prompt`, async ({ anonApi }) => {
      const res = await anonApi.ctx.get(path);
      expect(res.status()).toBe(401);
      expect(res.headers()['www-authenticate']).toBeUndefined();
      expect(await res.json()).toMatchObject({ status: 401, error: 'Unauthorized' });
    });
  }

  test('wrong password is rejected with 401', async () => {
    const ctx = await apiContext('anonymous');
    try {
      const bad = 'Basic ' + Buffer.from(`${ENV.admin.username}:definitely-wrong`).toString('base64');
      const res = await ctx.get('/api/auth/me', { headers: { Authorization: bad } });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test('/api/auth/me returns the identity and role of admin and viewer', async ({ adminApi, viewerApi }) => {
    expect(await adminApi.ok(adminApi.ctx.get('/api/auth/me'))).toEqual({ username: ENV.admin.username, roles: ['ROLE_ADMIN'] });
    expect(await viewerApi.ok(viewerApi.ctx.get('/api/auth/me'))).toEqual({ username: ENV.viewer.username, roles: ['ROLE_VIEWER'] });
  });

  test('viewer can read everything an administrator reviews', async ({ viewerApi }) => {
    for (const path of ['/api/dashboard', '/api/policy', '/api/events', '/api/audit', '/api/recommendations',
      '/api/enforcements', '/api/audit/verify', '/api/ml/status']) {
      const res = await viewerApi.ctx.get(path);
      expect(res.status(), path).toBe(200);
    }
  });

  const mutations: [string, string][] = [
    ['POST', '/api/events'], ['PUT', '/api/events/1'], ['DELETE', '/api/events/1'], ['POST', '/api/events/import'],
    ['PUT', '/api/policy'], ['POST', '/api/network/init'], ['POST', '/api/topology/reload'],
    ['POST', '/api/recommendations/evaluate'], ['POST', '/api/recommendations/1/approve'], ['POST', '/api/recommendations/1/reject'],
    ['POST', '/api/enforcements/1/revert'], ['POST', '/api/enforcements/1/inject-regression'],
    ['POST', '/api/predictions/run'], ['POST', '/api/scenarios'], ['DELETE', '/api/scenarios'],
    ['POST', '/api/scenarios/live-traffic'], ['PUT', '/api/ml/provider']
  ];
  for (const [method, path] of mutations) {
    test(`viewer ${method} ${path} -> 403 (read-only role)`, async ({ viewerApi }) => {
      const res = await viewerApi.ctx.fetch(path, { method, data: {} });
      expect(res.status()).toBe(403);
    });
  }

  test('anonymous mutations are rejected before any validation (401, not 400)', async ({ anonApi }) => {
    const res = await anonApi.ctx.post('/api/events', { data: { name: '' } });
    expect(res.status()).toBe(401);
  });
});
