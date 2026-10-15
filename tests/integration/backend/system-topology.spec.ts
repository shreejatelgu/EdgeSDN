import { expect, requireBackend, requireNetwork, requireNoTopology, test } from '../../fixtures/fixtures';

test.describe('System status, topology, telemetry and dashboard APIs', () => {
  test.beforeEach(({ stack }) => requireBackend(stack));

  test('health reports every dependency of the platform', async ({ adminApi }) => {
    const h = await adminApi.health();
    expect(h.backend).toBe('UP');
    expect(typeof h.topologyLoaded).toBe('boolean');
    expect(h.controller).toEqual(expect.objectContaining({
      reachable: expect.any(Boolean), connectedSwitches: expect.any(Number), message: expect.any(String)
    }));
    expect(['UP', 'DOWN']).toContain(h.agent.status);
    expect(h.telemetry).toEqual(expect.objectContaining({ stale: expect.any(Boolean) }));
    expect(h.prediction.available).toEqual(expect.arrayContaining(['RULE_BASED', 'ML']));
    expect(h.prediction.available).toContain(h.prediction.active);
  });

  test('topology view is consistent with health', async ({ adminApi }) => {
    const h = await adminApi.health();
    const t = await adminApi.ok<any>(adminApi.ctx.get('/api/topology'));
    expect(t.loaded).toBe(h.topologyLoaded);
    if (t.loaded) {
      expect(t.topology.switches).toHaveLength(12);
      expect(t.topology.links).toHaveLength(15);
      expect(t.error).toBeNull();
    } else {
      expect(t.topology).toBeNull();
      expect(t.error).toMatch(/agent|unreachable|not loaded/i);
    }
  });

  test('dashboard aggregates topology, telemetry, forecast, decisions and policy', async ({ viewerApi }) => {
    const d = await viewerApi.ok<any>(viewerApi.ctx.get('/api/dashboard'));
    for (const key of ['topologyLoaded', 'links', 'groups', 'telemetryStale', 'provider', 'openRecommendations',
      'activeEnforcements', 'approvalMode']) {
      expect(d, `dashboard.${key}`).toHaveProperty(key);
    }
    expect(['MANUAL', 'AUTO_LOW_RISK']).toContain(d.approvalMode);
    expect(d.links).toHaveLength(d.topologyLoaded ? 15 : 0);
    for (const r of d.openRecommendations) {
      expect(['SIMULATING', 'PENDING_APPROVAL', 'APPROVED', 'AUTO_APPROVED', 'APPLYING', 'MONITORING']).toContain(r.status);
    }
    for (const e of d.activeEnforcements) { expect(['APPLYING', 'MONITORING', 'VERIFIED']).toContain(e.status); }
  });

  test('telemetry snapshot shape; utilisation values are non-negative fractions', async ({ viewerApi }) => {
    const t = await viewerApi.ok<any>(viewerApi.ctx.get('/api/telemetry/latest'));
    expect(['ODL', 'AGENT']).toContain(t.source);
    expect(typeof t.stale).toBe('boolean');
    for (const l of t.links) {
      expect(l.utilization).toBeGreaterThanOrEqual(0);
      expect(l.mbps).toBeGreaterThanOrEqual(0);
      expect(l.capacityMbps).toBeGreaterThan(0);
    }
  });

  test('telemetry history for an unknown link is an empty list, and minutes are bounded', async ({ viewerApi }) => {
    const rows = await viewerApi.ok<any[]>(viewerApi.ctx.get('/api/telemetry/history', {
      params: { subjectType: 'link', subjectId: 'zz-zz', minutes: 99999999 }
    }));
    expect(rows).toEqual([]);
  });

  test('network status reports controller, agent and live-traffic state', async ({ adminApi }) => {
    const s = await adminApi.ok<any>(adminApi.ctx.get('/api/network/status'));
    expect(s).toHaveProperty('controller');
    expect(s).toHaveProperty('agent');
    expect(s).toHaveProperty('liveTraffic');
  });

  test('without the twin-agent, network operations fail with 502 and a clear message', async ({ adminApi, stack }) => {
    requireNoTopology(stack);
    for (const pending of [adminApi.initNetwork(), adminApi.runForecast(),
      adminApi.addScenario({ linkId: 'c1-d4', horizonMinutes: null, predictedUtilization: 0.9, confidence: 0.8, durationMinutes: 5, note: 't' })]) {
      const res = await pending;
      expect(res.status()).toBe(502);
      expect((await res.json()).message).toContain('Topology not loaded');
    }
  });

  test('topology reload keeps the backend usable when the agent is down', async ({ adminApi }) => {
    const t = await adminApi.ok<any>(adminApi.ctx.post('/api/topology/reload'));
    expect(typeof t.loaded).toBe('boolean');
    await adminApi.health();
  });

  test('with the live network: baseline routing is programmed on all 12 switches', async ({ adminApi, stack }) => {
    requireNetwork(stack);
    const r = await adminApi.ok<any>(adminApi.initNetwork());
    expect(r.switches).toBe(12);
    // 16 hosts x 12 switches baseline rules + 12 default goto rules
    expect(r.flowsInstalled).toBe(16 * 12 + 12);
    expect(r.errors).toEqual([]);
    const h = await adminApi.health();
    expect(h.controller.connectedSwitches).toBe(12);
  });
});
