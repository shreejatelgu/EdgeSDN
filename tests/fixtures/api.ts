import { expect, request, type APIRequestContext, type APIResponse } from '@playwright/test';
import type {
  AuditEvent, Enforcement, EventRequest, ForecastRun, InstitutionalEvent, PageResponse, PolicyConfig,
  Recommendation, RecommendationView, ScenarioOverride, VerifyResult
} from '../../frontend/src/app/core/models';
import { ENV, basicAuth, type Role } from './env';

export interface Health {
  backend: string;
  topologyLoaded: boolean;
  topologyError: string | null;
  controller: { reachable: boolean; connectedSwitches: number; message: string };
  agent: { status: string; [k: string]: unknown };
  telemetry: { polledAt: string; stale: boolean; error: string };
  prediction: { active: string; available: string[] };
}

export interface ScenarioBody {
  linkId: string; horizonMinutes: number | null; predictedUtilization: number; confidence: number;
  durationMinutes: number; note: string;
}

/** API context for the backend as admin, viewer or anonymous (Basic auth sent on every request). */
export async function apiContext(role: Role | 'anonymous', baseURL = ENV.backendUrl): Promise<APIRequestContext> {
  const extraHTTPHeaders: Record<string, string> = { Accept: 'application/json' };
  if (role !== 'anonymous') {
    // Sent pre-emptively: the backend deliberately omits WWW-Authenticate, so there is no challenge to answer.
    extraHTTPHeaders['Authorization'] = basicAuth(role);
  }
  return request.newContext({ baseURL, extraHTTPHeaders, timeout: 30_000 });
}

/** Asserts the status and shows the response body in the failure message. */
export async function expectStatus(res: APIResponse, status: number): Promise<void> {
  if (res.status() !== status) {
    expect(res.status(), `${res.url()} returned ${res.status()}: ${(await res.text()).slice(0, 500)}`).toBe(status);
  }
}

function params(q: Record<string, string | number | undefined | null>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== '') { out[k] = v; }
  }
  return out;
}

/** Typed helpers over the backend REST API for setup, verification and clean-up. */
export class EdgeApi {
  constructor(readonly ctx: APIRequestContext) {}

  async ok<T>(pending: Promise<APIResponse>, status = 200): Promise<T> {
    const res = await pending;
    await expectStatus(res, status);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // ---- system
  health(): Promise<Health> { return this.ok(this.ctx.get('/api/system/health')); }

  // ---- policy
  policy(): Promise<PolicyConfig> { return this.ok(this.ctx.get('/api/policy')); }
  putPolicy(body: unknown): Promise<APIResponse> { return this.ctx.put('/api/policy', { data: body }); }
  async updatePolicy(patch: Partial<PolicyConfig>): Promise<PolicyConfig> {
    const current = await this.policy();
    return this.ok(this.putPolicy({ ...current, ...patch }));
  }

  // ---- events
  events(): Promise<InstitutionalEvent[]> { return this.ok(this.ctx.get('/api/events')); }
  postEvent(body: unknown): Promise<APIResponse> { return this.ctx.post('/api/events', { data: body }); }
  createEvent(body: EventRequest): Promise<InstitutionalEvent> { return this.ok(this.postEvent(body), 201); }
  deleteEvent(id: number): Promise<APIResponse> { return this.ctx.delete(`/api/events/${id}`); }
  importCsv(csv: string): Promise<APIResponse> {
    return this.ctx.post('/api/events/import', { data: csv, headers: { 'Content-Type': 'text/plain' } });
  }
  /** Deletes every event created by the tests (name starts with the test prefix). */
  async cleanupEvents(): Promise<number> {
    let removed = 0;
    for (const e of await this.events()) {
      if (e.name.startsWith(ENV.prefix)) {
        await this.deleteEvent(e.id);
        removed++;
      }
    }
    return removed;
  }

  // ---- audit
  audit(q: { type?: string; recommendationId?: number; page?: number; size?: number } = {}): Promise<PageResponse<AuditEvent>> {
    return this.ok(this.ctx.get('/api/audit', { params: params(q) }));
  }
  verifyAudit(): Promise<VerifyResult> { return this.ok(this.ctx.get('/api/audit/verify')); }

  // ---- recommendations / enforcements
  recommendations(status?: string): Promise<Recommendation[]> {
    return this.ok(this.ctx.get('/api/recommendations', { params: params({ status }) }));
  }
  recommendation(id: number): Promise<RecommendationView> { return this.ok(this.ctx.get(`/api/recommendations/${id}`)); }
  approve(id: number, candidateId: number | null = null, comment = ''): Promise<APIResponse> {
    return this.ctx.post(`/api/recommendations/${id}/approve`, { data: { candidateId, comment } });
  }
  reject(id: number, reason = ''): Promise<APIResponse> {
    return this.ctx.post(`/api/recommendations/${id}/reject`, { data: { reason } });
  }
  evaluate(): Promise<APIResponse> { return this.ctx.post('/api/recommendations/evaluate'); }
  enforcements(): Promise<Enforcement[]> { return this.ok(this.ctx.get('/api/enforcements')); }
  revert(id: number, reason = ''): Promise<APIResponse> {
    return this.ctx.post(`/api/enforcements/${id}/revert`, { data: { reason } });
  }
  injectRegression(id: number): Promise<APIResponse> { return this.ctx.post(`/api/enforcements/${id}/inject-regression`); }

  // ---- predictions / scenarios / ML
  latestForecast(): Promise<APIResponse> { return this.ctx.get('/api/predictions/latest'); }
  runForecast(): Promise<APIResponse> { return this.ctx.post('/api/predictions/run'); }
  async runForecastOk(): Promise<ForecastRun> { return this.ok(this.runForecast()); }
  scenarios(): Promise<ScenarioOverride[]> { return this.ok(this.ctx.get('/api/scenarios')); }
  addScenario(body: ScenarioBody): Promise<APIResponse> { return this.ctx.post('/api/scenarios', { data: body }); }
  clearScenarios(): Promise<APIResponse> { return this.ctx.delete('/api/scenarios'); }
  startLiveTraffic(demands: Record<string, number>, durationSec: number): Promise<APIResponse> {
    return this.ctx.post('/api/scenarios/live-traffic', { data: { demands, durationSec } });
  }
  stopLiveTraffic(): Promise<APIResponse> { return this.ctx.post('/api/scenarios/live-traffic/stop'); }
  mlStatus(): Promise<Record<string, any>> { return this.ok(this.ctx.get('/api/ml/status')); }
  setProvider(provider: string): Promise<APIResponse> { return this.ctx.put('/api/ml/provider', { data: { provider } }); }

  // ---- network
  initNetwork(): Promise<APIResponse> { return this.ctx.post('/api/network/init'); }
}
