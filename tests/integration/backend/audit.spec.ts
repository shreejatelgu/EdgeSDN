import type { EdgeApi } from '../../fixtures/api';
import { uniqueName } from '../../fixtures/env';
import { expect, requireBackend, test } from '../../fixtures/fixtures';

test.describe('Audit log API (append-only, hash-chained)', () => {
  test.beforeEach(({ stack }) => requireBackend(stack));
  test.afterEach(async ({ adminApi }) => { await adminApi.cleanupEvents(); });

  async function createEvent(adminApi: EdgeApi) {
    return adminApi.createEvent({
      name: uniqueName('Audit probe'), type: 'OTHER', startTime: new Date(Date.now() + 3_600_000).toISOString(),
      durationMinutes: 30, expectedIntensity: 0.1, affectedGroups: [], description: null
    });
  }

  test('pagination shape, newest first', async ({ adminApi }) => {
    await createEvent(adminApi);
    const page = await adminApi.audit({ page: 0, size: 10 });
    expect(page.page).toBe(0);
    expect(page.size).toBe(10);
    expect(page.content.length).toBeGreaterThan(0);
    expect(page.content.length).toBeLessThanOrEqual(10);
    expect(page.totalElements).toBeGreaterThanOrEqual(page.content.length);
    const ids = page.content.map(a => a.id);
    expect([...ids].sort((a, b) => b - a)).toEqual(ids);
  });

  test('page size is capped at 500', async ({ adminApi }) => {
    expect((await adminApi.audit({ size: 5000 })).size).toBe(500);
  });

  test('filter by type returns only that type', async ({ adminApi }) => {
    await createEvent(adminApi);
    const page = await adminApi.audit({ type: 'EVENT_CREATED', size: 50 });
    expect(page.content.length).toBeGreaterThan(0);
    for (const a of page.content) { expect(a.type).toBe('EVENT_CREATED'); }
  });

  test('filter by an unknown recommendation returns nothing', async ({ adminApi }) => {
    const page = await adminApi.audit({ recommendationId: 999999999 });
    expect(page.content).toEqual([]);
    expect(page.totalElements).toBe(0);
  });

  test('unknown type -> 400', async ({ adminApi }) => {
    const res = await adminApi.ctx.get('/api/audit', { params: { type: 'NOT_A_TYPE' } });
    expect(res.status()).toBe(400);
  });

  test('records who did what: actor, type and summary of the latest action', async ({ adminApi }) => {
    const e = await createEvent(adminApi);
    const latest = (await adminApi.audit({ type: 'EVENT_CREATED', size: 1 })).content[0];
    expect(latest.actor).toBe('admin');
    expect(latest.summary).toBe(`Event created: ${e.name}`);
    // generous window: backend and test runner clocks may differ slightly
    expect(new Date(latest.ts).getTime()).toBeGreaterThan(Date.now() - 30 * 60_000);
  });

  test('each entry links to the previous one (prevHash = hash of the previous entry)', async ({ adminApi }) => {
    await createEvent(adminApi);
    await createEvent(adminApi);
    const content = (await adminApi.audit({ size: 100 })).content; // newest first
    let checked = 0;
    for (let i = 0; i + 1 < content.length; i++) {
      if (content[i].id === content[i + 1].id + 1) {
        expect(content[i].prevHash, `entry ${content[i].id}`).toBe(content[i + 1].hash);
        checked++;
      }
      expect(content[i].hash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(checked).toBeGreaterThan(0);
  });

  test('verification of the whole chain succeeds', async ({ adminApi, viewerApi }) => {
    await createEvent(adminApi);
    const result = await viewerApi.verifyAudit();
    expect(result).toMatchObject({ valid: true, firstBrokenId: null, message: 'Audit chain intact' });
    expect(result.checked).toBeGreaterThan(0);
  });

  test('the audit log cannot be modified through the API', async ({ adminApi }) => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await adminApi.ctx.fetch('/api/audit', { method, data: {} });
      expect([404, 405], `${method} /api/audit`).toContain(res.status());
    }
  });
});
