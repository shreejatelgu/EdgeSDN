import { apiContext } from '../../fixtures/api';
import { expect, requireBackend, test } from '../../fixtures/fixtures';

test.describe('Backend error contract and CORS', () => {
  test.beforeEach(({ stack }) => requireBackend(stack));

  test('unknown API path -> 404 JSON with the path', async ({ adminApi }) => {
    const res = await adminApi.ctx.get('/api/does-not-exist');
    expect(res.status()).toBe(404);
    expect(await res.json()).toMatchObject({ status: 404, path: '/api/does-not-exist' });
  });

  test('unsupported HTTP method -> 405 (not 500)', async ({ adminApi }) => {
    const res = await adminApi.ctx.delete('/api/policy');
    expect(res.status()).toBe(405);
    expect((await res.json()).message).toContain("'DELETE' is not supported");
  });

  test('invalid enum query parameter -> 400', async ({ adminApi }) => {
    const res = await adminApi.ctx.get('/api/recommendations', { params: { status: 'BOGUS' } });
    expect(res.status()).toBe(400);
  });

  test('non-numeric path id -> 400', async ({ adminApi }) => {
    const res = await adminApi.ctx.get('/api/recommendations/abc');
    expect(res.status()).toBe(400);
  });

  test('malformed JSON body -> 400 "Malformed request body"', async ({ adminApi }) => {
    const res = await adminApi.ctx.post('/api/events', {
      data: '{not json', headers: { 'Content-Type': 'application/json' }
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toBe('Malformed request body');
  });

  test('every error body has the same ApiError shape', async ({ adminApi }) => {
    const res = await adminApi.ctx.get('/api/recommendations/999999999');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['error', 'message', 'path', 'status', 'timestamp']);
    expect(body.message).toBe('Recommendation 999999999 not found');
  });

  test('CORS preflight from the Angular dev origin is allowed', async () => {
    const ctx = await apiContext('anonymous');
    try {
      const res = await ctx.fetch('/api/events', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:4200',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type'
        }
      });
      expect(res.status()).toBe(200);
      expect(res.headers()['access-control-allow-origin']).toBe('http://localhost:4200');
      expect((res.headers()['access-control-allow-methods'] ?? '').toUpperCase()).toContain('POST');
    } finally {
      await ctx.dispose();
    }
  });

  test('CORS preflight from a foreign origin is refused', async () => {
    const ctx = await apiContext('anonymous');
    try {
      const res = await ctx.fetch('/api/events', {
        method: 'OPTIONS',
        headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'POST' }
      });
      expect(res.status()).toBe(403);
      expect(res.headers()['access-control-allow-origin']).toBeUndefined();
    } finally {
      await ctx.dispose();
    }
  });
});
