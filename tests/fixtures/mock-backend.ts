import { expect, type Page, type Route } from '@playwright/test';
import { OPEN_STATUSES, dashboardOf, mockData, type MockState } from './mock-data';

export interface MockRequest { method: string; path: string; query: URLSearchParams; body: any; }
export interface MockResponse { status?: number; json?: unknown; text?: string; contentType?: string; }
export type MockHandler = (req: MockRequest, state: MockState) => MockResponse | Promise<MockResponse>;

const notFound = (message: string): MockResponse => ({ status: 404, json: { status: 404, error: 'Not Found', message } });

/**
 * Stateful fake of the backend REST API, served from inside the browser with page.route().
 * Only the Angular dev server has to run. Every call is recorded for assertions; `on()` overrides a route.
 */
export class MockBackend {
  readonly calls: MockRequest[] = [];
  readonly state: MockState;
  private readonly overrides: { method: string; pattern: RegExp; handler: MockHandler }[] = [];

  constructor(private readonly page: Page, patch?: (s: MockState) => void) {
    this.state = mockData();
    patch?.(this.state);
  }

  on(method: string, pattern: RegExp, handler: MockHandler): this {
    this.overrides.unshift({ method, pattern, handler });
    return this;
  }

  /** Seeds a logged-in session for `role` and starts intercepting /api/**. */
  async install(role: 'admin' | 'viewer' = 'admin'): Promise<this> {
    this.state.me = role === 'admin'
      ? { username: 'admin', roles: ['ROLE_ADMIN'] }
      : { username: 'viewer', roles: ['ROLE_VIEWER'] };
    const session = JSON.stringify({ token: 'Basic bW9jazptb2Nr', me: this.state.me });
    await this.page.addInitScript(v => window.sessionStorage.setItem('edge-sdn-auth', v), session);
    await this.page.route('**/api/**', route => this.handle(route));
    return this;
  }

  callsTo(method: string, pattern: RegExp): MockRequest[] {
    return this.calls.filter(c => c.method === method && pattern.test(c.path));
  }

  /** Waits until a matching call was made and returns the most recent one. */
  async waitForCall(method: string, pattern: RegExp, timeout = 10_000): Promise<MockRequest> {
    await expect.poll(() => this.callsTo(method, pattern).length, { timeout }).toBeGreaterThan(0);
    const matches = this.callsTo(method, pattern);
    return matches[matches.length - 1];
  }

  private async handle(route: Route): Promise<void> {
    const r = route.request();
    const url = new URL(r.url());
    const raw = r.postData();
    let body: any = null;
    if (raw) {
      try { body = JSON.parse(raw); } catch { body = raw; }
    }
    const req: MockRequest = { method: r.method(), path: url.pathname, query: url.searchParams, body };
    this.calls.push(req);
    const override = this.overrides.find(o => o.method === req.method && o.pattern.test(req.path));
    const res = override ? await override.handler(req, this.state) : defaultHandler(req, this.state);
    const status = res.status ?? 200;
    await route.fulfill({
      status,
      contentType: res.contentType ?? 'application/json',
      body: res.text ?? (res.json === undefined || status === 204 ? '' : JSON.stringify(res.json))
    });
  }
}

function defaultHandler(req: MockRequest, s: MockState): MockResponse {
  const { method: m, path: p } = req;
  let match: RegExpMatchArray | null;

  if (m === 'GET' && p === '/api/auth/me') { return { json: s.me }; }
  if (m === 'GET' && p === '/api/dashboard') { return { json: dashboardOf(s) }; }
  if (m === 'GET' && p === '/api/system/health') { return { json: { backend: 'UP', topologyLoaded: s.topologyLoaded } }; }

  // ---- recommendations
  if (m === 'GET' && p === '/api/recommendations') {
    const status = req.query.get('status');
    const list = s.recommendations.map(v => v.recommendation).filter(r => !status || r.status === status);
    return { json: list };
  }
  if (m === 'POST' && p === '/api/recommendations/evaluate') {
    return { json: { runId: 'run-mock-2', provider: 'RULE_BASED', forecasts: 6 } };
  }
  if ((match = p.match(/^\/api\/recommendations\/(\d+)$/)) && m === 'GET') {
    const v = s.recommendations.find(x => x.recommendation.id === Number(match![1]));
    return v ? { json: v } : notFound(`Recommendation ${match[1]} not found`);
  }
  if ((match = p.match(/^\/api\/recommendations\/(\d+)\/(approve|reject)$/)) && m === 'POST') {
    const v = s.recommendations.find(x => x.recommendation.id === Number(match![1]));
    if (!v) { return notFound(`Recommendation ${match[1]} not found`); }
    const rec = v.recommendation;
    if (rec.status !== 'PENDING_APPROVAL') {
      return { status: 409, json: { status: 409, error: 'Conflict', message: `Recommendation ${rec.id} is ${rec.status}, not PENDING_APPROVAL` } };
    }
    const now = new Date().toISOString();
    rec.decidedBy = s.me.username;
    rec.decidedAt = now;
    rec.updatedAt = now;
    if (match[2] === 'approve') {
      rec.status = 'MONITORING';
      rec.approvedCandidateId = req.body?.candidateId ?? rec.selectedCandidateId;
      rec.decisionComment = req.body?.comment ?? null;
      rec.enforcementId = 99;
    } else {
      rec.status = 'REJECTED';
      rec.decisionComment = req.body?.reason ?? null;
    }
    return { json: rec };
  }

  // ---- enforcements
  if (m === 'GET' && p === '/api/enforcements') { return { json: s.enforcements }; }
  if ((match = p.match(/^\/api\/enforcements\/(\d+)\/(revert|inject-regression)$/)) && m === 'POST') {
    const e = s.enforcements.find(x => x.id === Number(match![1]));
    if (!e) { return notFound(`Enforcement ${match[1]} not found`); }
    if (match[2] === 'revert') {
      e.status = 'REVERTED';
      e.endReason = 'Manual revert: ' + (req.body?.reason || 'by administrator');
    } else {
      e.regressionInjected = true;
    }
    return { json: e };
  }

  // ---- audit
  if (m === 'GET' && p === '/api/audit') {
    const type = req.query.get('type');
    const rec = req.query.get('recommendationId');
    const content = s.audit.filter(a => (!type || a.type === type) && (!rec || a.recommendationId === Number(rec)));
    return { json: { content, page: 0, size: 50, totalElements: content.length, totalPages: 1 } };
  }
  if (m === 'GET' && p === '/api/audit/verify') {
    return { json: { valid: true, checked: s.audit.length, firstBrokenId: null, message: 'Audit chain intact' } };
  }

  // ---- predictions / ML
  if (m === 'GET' && p === '/api/predictions/latest') {
    return s.forecast ? { json: s.forecast } : { status: 204 };
  }
  if (m === 'POST' && p === '/api/predictions/run') {
    return s.forecast ? { json: s.forecast } : { status: 502, json: { status: 502, message: 'Topology not loaded' } };
  }
  if (m === 'GET' && p === '/api/ml/status') { return { json: s.mlStatus }; }
  if (m === 'PUT' && p === '/api/ml/provider') {
    s.mlStatus = { ...s.mlStatus, activeProvider: req.body?.provider };
    return { json: { activeProvider: req.body?.provider } };
  }

  // ---- telemetry / topology / network
  if (m === 'GET' && p === '/api/telemetry/latest') { return { json: { ...s.telemetry, stale: s.telemetryStale } }; }
  if (m === 'GET' && p === '/api/telemetry/history') {
    return { json: s.history[req.query.get('subjectId') ?? ''] ?? [] };
  }
  if ((m === 'GET' && p === '/api/topology') || (m === 'POST' && p === '/api/topology/reload')) {
    return { json: { loaded: s.topologyLoaded, error: s.topologyError, topology: s.topologyLoaded ? s.topology : null } };
  }
  if (m === 'POST' && p === '/api/network/init') {
    return { json: { at: new Date().toISOString(), actor: s.me.username, switches: 12, flowsInstalled: 204, errors: [] } };
  }
  if (m === 'GET' && p === '/api/network/status') { return { json: s.networkStatus }; }

  // ---- scenarios / live traffic
  if (m === 'GET' && p === '/api/scenarios') { return { json: s.scenarios }; }
  if (m === 'POST' && p === '/api/scenarios') {
    const sc = {
      id: `sc-${s.scenarios.length + 1}`, linkId: req.body.linkId, horizonMinutes: req.body.horizonMinutes,
      predictedUtilization: req.body.predictedUtilization, confidence: req.body.confidence,
      expiresAt: new Date(Date.now() + (req.body.durationMinutes ?? 30) * 60_000).toISOString(),
      note: req.body.note, createdBy: s.me.username
    };
    s.scenarios.push(sc);
    return { status: 201, json: sc };
  }
  if (m === 'DELETE' && p === '/api/scenarios') { s.scenarios = []; return { status: 204 }; }
  if ((match = p.match(/^\/api\/scenarios\/([\w-]+)$/)) && m === 'DELETE') {
    const before = s.scenarios.length;
    s.scenarios = s.scenarios.filter(x => x.id !== match![1]);
    return s.scenarios.length < before ? { status: 204 } : notFound(`Scenario ${match[1]} not found`);
  }
  if (m === 'POST' && p === '/api/scenarios/live-traffic') {
    const demands = (req.body?.demands ?? {}) as Record<string, number>;
    const offered = Object.values(demands).reduce((a, b) => a + b, 0);
    return { json: { running: true, streams: Object.keys(demands).length, offeredMbps: offered, remainingSec: req.body?.durationSec } };
  }
  if (m === 'POST' && p === '/api/scenarios/live-traffic/stop') {
    return { json: { running: false, streams: 0, offeredMbps: 0, remainingSec: 0 } };
  }

  // ---- policy / events
  if (m === 'GET' && p === '/api/policy') { return { json: s.policy }; }
  if (m === 'PUT' && p === '/api/policy') { s.policy = { ...s.policy, ...req.body }; return { json: s.policy }; }
  if (m === 'GET' && p === '/api/events') { return { json: s.events }; }

  return notFound(`No mock for ${m} ${p}`);
}

export { OPEN_STATUSES };
