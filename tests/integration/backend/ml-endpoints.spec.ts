import { expectStatus } from '../../fixtures/api';
import { uniqueName } from '../../fixtures/env';
import { expect, requireBackend, test } from '../../fixtures/fixtures';

test.describe('ML integration endpoints of the backend', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(({ stack }) => requireBackend(stack));
  test.afterEach(async ({ adminApi }) => {
    await adminApi.setProvider('RULE_BASED');
    await adminApi.cleanupEvents();
  });

  test('status lists providers, the active one and ML reachability', async ({ viewerApi }) => {
    const s = await viewerApi.mlStatus();
    expect(s.availableProviders).toEqual(expect.arrayContaining(['RULE_BASED', 'ML']));
    expect(s.availableProviders).toContain(s.activeProvider);
    expect(typeof s.reachable).toBe('boolean');
    expect(typeof s.fallbackToRuleBased).toBe('boolean');
    if (s.reachable) {
      expect(s.health).toHaveProperty('status', 'UP');
    } else {
      expect(s.error).toContain('ML service');
    }
  });

  test('provider can be switched at runtime and the switch is audited', async ({ adminApi }) => {
    const res = await adminApi.setProvider('ml');
    expect(await res.json()).toEqual({ activeProvider: 'ML' });
    expect((await adminApi.mlStatus()).activeProvider).toBe('ML');
    const entry = (await adminApi.audit({ type: 'PROVIDER_CHANGED', size: 1 })).content[0];
    expect(entry.summary).toMatch(/-> ML$/);
    expect(entry.actor).toBe('admin');
    await expectStatus(await adminApi.setProvider('RULE_BASED'), 200);
    expect((await adminApi.mlStatus()).activeProvider).toBe('RULE_BASED');
  });

  test('unknown provider -> 400 and the active provider is unchanged', async ({ adminApi }) => {
    const res = await adminApi.setProvider('GPT');
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toContain('Unknown provider');
    expect((await adminApi.mlStatus()).activeProvider).toBe('RULE_BASED');
  });

  test('telemetry training-data export is a downloadable CSV', async ({ viewerApi }) => {
    const res = await viewerApi.ctx.get('/api/ml/training-data/telemetry.csv', { params: { hours: 1 } });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
    expect(res.headers()['content-disposition']).toContain('filename="telemetry.csv"');
    const lines = (await res.text()).trim().split('\n');
    expect(lines[0]).toBe('ts,subject_type,subject_id,mbps,utilization');
    for (const line of lines.slice(1, 20)) {
      expect(line.split(',')).toHaveLength(5);
    }
  });

  test('hours parameter is bounded (0 and huge values still work)', async ({ viewerApi }) => {
    for (const hours of [0, 100000]) {
      const res = await viewerApi.ctx.get('/api/ml/training-data/telemetry.csv', { params: { hours } });
      expect(res.status()).toBe(200);
    }
  });

  test('event export contains every event with quoted names and ";"-separated groups', async ({ adminApi }) => {
    const name = uniqueName('Export, with comma');
    await adminApi.createEvent({
      name, type: 'PLACEMENT', startTime: new Date(Date.now() + 7_200_000).toISOString(), durationMinutes: 60,
      expectedIntensity: 0.4, affectedGroups: ['LAB', 'ADMIN'], description: null
    });
    const res = await adminApi.ctx.get('/api/ml/training-data/events.csv');
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text.split('\n')[0]).toBe('id,name,type,start_time,end_time,duration_minutes,expected_intensity,affected_groups');
    const row = text.split('\n').find(l => l.includes(name))!;
    expect(row).toContain(`"${name}"`);
    expect(row).toContain('PLACEMENT');
    expect(row).toMatch(/"LAB;ADMIN"$/);
  });

  test('explain / counterfactual pass-through: 502 unless the topology and the ML service are both available', async ({ adminApi, stack }) => {
    const explain = await adminApi.ctx.get('/api/ml/explain', { params: { linkId: 'c1-d4', horizonMinutes: 30, method: 'SHAP' } });
    const cf = await adminApi.ctx.get('/api/ml/counterfactual', { params: { linkId: 'c1-d4', horizonMinutes: 30, targetUtilization: 0.7 } });
    if (stack.topologyLoaded && stack.mlReachable) {
      expect(explain.status()).toBe(200);
      expect(await explain.json()).toHaveProperty('explanation');
      expect(cf.status()).toBe(200);
      expect(await cf.json()).toHaveProperty('counterfactuals');
    } else {
      expect(explain.status()).toBe(502);
      expect(cf.status()).toBe(502);
    }
  });
});
