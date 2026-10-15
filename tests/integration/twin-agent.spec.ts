import { request, type APIRequestContext } from '@playwright/test';
import { ENV } from '../fixtures/env';
import { expect, test } from '../fixtures/fixtures';

/**
 * Contract of the Python twin-agent (runs as root in the Ubuntu VM).
 * Skipped when the agent is unreachable; EDGE_REQUIRE_AGENT=1 turns that into a failure.
 */
let agent: APIRequestContext;
let available = false;

test.beforeAll(async () => {
  agent = await request.newContext({ baseURL: ENV.agentUrl, extraHTTPHeaders: { 'X-Edge-Token': ENV.agentToken }, timeout: 60_000 });
  const res = await agent.get('/health', { timeout: 5_000 }).catch(() => null);
  available = !!res && res.ok();
});

test.afterAll(async () => { await agent?.dispose(); });

test.beforeEach(() => {
  const reason = `twin-agent not reachable at ${ENV.agentUrl} (SETUP_GUIDE step 6)`;
  if (ENV.requireAgent) { expect(available, reason).toBe(true); } else { test.skip(!available, reason); }
});

const flow = (overrides: Record<string, unknown> = {}) => ({
  id: 'edge-test-1', switchName: 'c1', table: 0, priority: 100,
  match: { ethType: 2048, ipv4Src: '10.0.10.0/24', ipv4Dst: '10.0.1.0/24', inPort: null },
  outputPort: 2, gotoTable: null, meterId: null, ...overrides
});
const simulate = (body: Record<string, unknown>) =>
  agent.post('/twin/simulate', { data: { flows: [], meters: [], traffic: [], probes: [], durationSec: 3, ...body } });

test.describe('twin-agent: health and authentication', () => {
  test('health is public and reports both networks', async () => {
    const anon = await request.newContext({ baseURL: ENV.agentUrl });
    try {
      const res = await anon.get('/health');
      expect(res.status()).toBe(200);
      const h = await res.json();
      expect(h).toMatchObject({ status: 'UP', live: true, twin: true });
      expect(['kernel', 'user']).toContain(h.datapath);
    } finally {
      await anon.dispose();
    }
  });

  test('topology requires the shared token', async () => {
    const anon = await request.newContext({ baseURL: ENV.agentUrl });
    try {
      expect((await anon.get('/topology')).status()).toBe(401);
      expect((await anon.get('/topology', { headers: { 'X-Edge-Token': 'wrong' } })).status()).toBe(401);
      expect((await anon.post('/twin/simulate', { data: {} })).status()).toBe(401);
    } finally {
      await anon.dispose();
    }
  });
});

test.describe('twin-agent: topology contract', () => {
  test('12 switches in three layers with unique DPIDs', async () => {
    const t = await (await agent.get('/topology')).json();
    expect(t.switches).toHaveLength(12);
    const roles = t.switches.reduce((m: Record<string, number>, s: any) => ({ ...m, [s.role]: (m[s.role] ?? 0) + 1 }), {});
    expect(roles).toEqual({ CORE: 2, DISTRIBUTION: 4, ACCESS: 6 });
    expect(new Set(t.switches.map((s: any) => s.dpid)).size).toBe(12);
  });

  test('15 links with sorted-endpoint ids and positive capacities; ports unique per switch', async () => {
    const t = await (await agent.get('/topology')).json();
    expect(t.links).toHaveLength(15);
    const used: Record<string, Set<number>> = {};
    const take = (sw: string, p: number) => {
      used[sw] ??= new Set();
      expect(used[sw].has(p), `port ${p} reused on ${sw}`).toBe(false);
      used[sw].add(p);
    };
    for (const l of t.links) {
      expect(l.id).toBe([l.a, l.b].sort().join('-'));
      expect(l.capacityMbps).toBeGreaterThan(0);
      take(l.a, l.aPort);
      take(l.b, l.bPort);
    }
    for (const h of t.hosts) { take(h.switchName, h.port); }
  });

  test('16 hosts inside their group subnet with unique MAC and IP; exactly one server group', async () => {
    const t = await (await agent.get('/topology')).json();
    expect(t.hosts).toHaveLength(16);
    expect(new Set(t.hosts.map((h: any) => h.mac)).size).toBe(16);
    expect(new Set(t.hosts.map((h: any) => h.ip)).size).toBe(16);
    const groups = new Map<string, any>(t.groups.map((g: any) => [g.name, g]));
    for (const h of t.hosts) {
      const g = groups.get(h.group);
      expect(g, `group of ${h.name}`).toBeTruthy();
      expect(h.ip.startsWith(g.subnet.replace('0/24', ''))).toBe(true);
      expect(h.switchName).toBe(g.accessSwitch);
      expect(g.hosts).toContain(h.name);
    }
    expect(t.groups.filter((g: any) => g.server).map((g: any) => g.name)).toEqual(['SERVERS']);
    for (const g of t.groups) { expect(['HIGH', 'MEDIUM', 'LOW']).toContain(g.priority); }
  });
});

test.describe('twin-agent: simulation request validation (nothing reaches ovs-ofctl)', () => {
  const cases: [string, Record<string, unknown>, number][] = [
    ['invalid CIDR', { flows: [flow({ match: { ipv4Dst: '10.0.1.999/24' } })] }, 422],
    ['flow id with shell characters', { flows: [flow({ id: 'x;rm -rf /' })] }, 422],
    ['unknown switch', { flows: [flow({ switchName: 'zz9' })] }, 400],
    ['duration below 3 s', { durationSec: 2 }, 422],
    ['duration above 30 s', { durationSec: 31 }, 422],
    ['zero-rate traffic', { traffic: [{ tag: 'LAB', src: 'h10n1', dst: 'h2n1', rateMbps: 0 }] }, 422],
    ['output port out of range', { flows: [flow({ outputPort: 70000 })] }, 422],
    ['meter on unknown switch', { meters: [{ switchName: 'zz9', meterId: 1, rateKbps: 1000, burstKb: 10 }] }, 400]
  ];
  for (const [label, body, status] of cases) {
    test(`${label} -> ${status}`, async () => {
      expect((await simulate(body)).status()).toBe(status);
    });
  }

  test('unknown host in the traffic profile -> 400', async () => {
    const res = await simulate({ traffic: [{ tag: 'LAB', src: 'h10n1', dst: 'h99n9', rateMbps: 1 }] });
    expect(res.status()).toBe(400);
  });
});

test.describe('twin-agent: measurements', () => {
  test('a twin with no rules drops all traffic, and every link is still measured', async () => {
    const res = await simulate({
      traffic: [{ tag: 'EXAM_HALL', src: 'h10n1', dst: 'h1n1', rateMbps: 1 }],
      probes: [{ tag: 'EXAM_HALL', src: 'h10n1', dst: 'h1n1' }]
    });
    expect(res.status()).toBe(200);
    const r = await res.json();
    expect(Object.keys(r.linkUtilization)).toHaveLength(15);
    expect(r.measuredSec).toBeGreaterThan(0);
    expect(r.flows).toHaveLength(1);
    expect(r.flows[0].offeredMbps).toBe(1);
    // without forwarding rules nothing is delivered: no report, or 100 % loss
    expect(r.flows[0].deliveredMbps === null || r.flows[0].lossPct === 100 || r.flows[0].deliveredMbps === 0).toBe(true);
    expect(r.probes[0].lossPct).toBe(100);
  });

  test('live probe returns latency/loss per pair', async () => {
    const res = await agent.post('/live/probe', { data: { pairs: [{ tag: 'EXAM_HALL', src: 'h10n1', dst: 'h1n1' }], count: 3 } });
    expect(res.status()).toBe(200);
    const [p] = (await res.json()).probes;
    expect(p).toMatchObject({ tag: 'EXAM_HALL', src: 'h10n1', dst: 'h1n1' });
    expect(p.lossPct).toBeGreaterThanOrEqual(0);
    expect(p.lossPct).toBeLessThanOrEqual(100);
  });

  test('live demo traffic can be started, inspected and stopped', async () => {
    const start = await agent.post('/live/traffic/start', {
      data: { traffic: [{ tag: 'LAB', src: 'h10n1', dst: 'h2n1', rateMbps: 1 }], durationSec: 10 }
    });
    expect(start.status()).toBe(200);
    expect(await start.json()).toMatchObject({ running: true, streams: 1, offeredMbps: 1 });
    expect(await (await agent.get('/live/traffic')).json()).toMatchObject({ running: true });
    const stop = await agent.post('/live/traffic/stop');
    expect(await stop.json()).toMatchObject({ running: false, streams: 0 });
  });
});
