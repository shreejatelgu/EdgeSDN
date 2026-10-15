import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AuditEvent, DashboardView, Enforcement, EventRequest, ForecastRun, InstitutionalEvent, PageResponse,
  PolicyConfig, PredictionRecordLike, Recommendation, RecommendationView, ScenarioOverride, TelemetrySample,
  TelemetrySnapshot, TopologyView, VerifyResult
} from './api.types';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly base = '/api';

  constructor(private http: HttpClient) {}

  // ---- dashboard / system
  dashboard(): Observable<DashboardView> { return this.http.get<DashboardView>(`${this.base}/dashboard`); }
  health(): Observable<Record<string, unknown>> { return this.http.get<Record<string, unknown>>(`${this.base}/system/health`); }

  // ---- topology / network
  topology(): Observable<TopologyView> { return this.http.get<TopologyView>(`${this.base}/topology`); }
  reloadTopology(): Observable<TopologyView> { return this.http.post<TopologyView>(`${this.base}/topology/reload`, {}); }
  initNetwork(): Observable<Record<string, unknown>> { return this.http.post<Record<string, unknown>>(`${this.base}/network/init`, {}); }
  networkStatus(): Observable<Record<string, any>> { return this.http.get<Record<string, any>>(`${this.base}/network/status`); }

  // ---- telemetry
  telemetryLatest(): Observable<TelemetrySnapshot> { return this.http.get<TelemetrySnapshot>(`${this.base}/telemetry/latest`); }
  telemetryHistory(subjectType: string, subjectId: string, minutes: number): Observable<TelemetrySample[]> {
    const params = new HttpParams().set('subjectType', subjectType).set('subjectId', subjectId).set('minutes', minutes);
    return this.http.get<TelemetrySample[]>(`${this.base}/telemetry/history`, { params });
  }

  // ---- events
  events(): Observable<InstitutionalEvent[]> { return this.http.get<InstitutionalEvent[]>(`${this.base}/events`); }
  createEvent(e: EventRequest): Observable<InstitutionalEvent> { return this.http.post<InstitutionalEvent>(`${this.base}/events`, e); }
  updateEvent(id: number, e: EventRequest): Observable<InstitutionalEvent> { return this.http.put<InstitutionalEvent>(`${this.base}/events/${id}`, e); }
  deleteEvent(id: number): Observable<void> { return this.http.delete<void>(`${this.base}/events/${id}`); }
  importEvents(csv: string): Observable<{ imported: number; errors: string[] }> {
    return this.http.post<{ imported: number; errors: string[] }>(`${this.base}/events/import`, csv,
      { headers: { 'Content-Type': 'text/plain' } });
  }

  // ---- predictions / scenarios / ML
  latestForecast(): Observable<ForecastRun | null> { return this.http.get<ForecastRun | null>(`${this.base}/predictions/latest`); }
  runForecast(): Observable<ForecastRun> { return this.http.post<ForecastRun>(`${this.base}/predictions/run`, {}); }
  predictionHistory(linkId: string, minutes: number): Observable<PredictionRecordLike[]> {
    const params = new HttpParams().set('linkId', linkId).set('minutes', minutes);
    return this.http.get<PredictionRecordLike[]>(`${this.base}/predictions/history`, { params });
  }
  scenarios(): Observable<ScenarioOverride[]> { return this.http.get<ScenarioOverride[]>(`${this.base}/scenarios`); }
  addScenario(body: { linkId: string; horizonMinutes: number | null; predictedUtilization: number; confidence: number; durationMinutes: number; note: string }): Observable<ScenarioOverride> {
    return this.http.post<ScenarioOverride>(`${this.base}/scenarios`, body);
  }
  deleteScenario(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/scenarios/${id}`); }
  clearScenarios(): Observable<void> { return this.http.delete<void>(`${this.base}/scenarios`); }
  startLiveTraffic(demands: Record<string, number>, durationSec: number): Observable<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>(`${this.base}/scenarios/live-traffic`, { demands, durationSec });
  }
  stopLiveTraffic(): Observable<Record<string, unknown>> { return this.http.post<Record<string, unknown>>(`${this.base}/scenarios/live-traffic/stop`, {}); }
  mlStatus(): Observable<Record<string, any>> { return this.http.get<Record<string, any>>(`${this.base}/ml/status`); }
  counterfactuals(linkId: string, horizonMinutes: number, targetUtilization: number, maxChanges = 2):
      Observable<{ counterfactuals: { description: string; predictedUtilization: number }[] }> {
    const params = new HttpParams().set('linkId', linkId).set('horizonMinutes', horizonMinutes)
      .set('targetUtilization', targetUtilization).set('maxChanges', maxChanges);
    return this.http.get<{ counterfactuals: { description: string; predictedUtilization: number }[] }>(
      `${this.base}/ml/counterfactual`, { params });
  }
  setProvider(provider: string): Observable<{ activeProvider: string }> {
    return this.http.put<{ activeProvider: string }>(`${this.base}/ml/provider`, { provider });
  }

  // ---- recommendations
  recommendations(status?: string): Observable<Recommendation[]> {
    const params = status ? new HttpParams().set('status', status) : undefined;
    return this.http.get<Recommendation[]>(`${this.base}/recommendations`, { params });
  }
  recommendation(id: number): Observable<RecommendationView> { return this.http.get<RecommendationView>(`${this.base}/recommendations/${id}`); }
  evaluateNow(): Observable<Record<string, unknown>> { return this.http.post<Record<string, unknown>>(`${this.base}/recommendations/evaluate`, {}); }
  approve(id: number, candidateId: number | null, comment: string): Observable<Recommendation> {
    return this.http.post<Recommendation>(`${this.base}/recommendations/${id}/approve`, { candidateId, comment });
  }
  reject(id: number, reason: string): Observable<Recommendation> {
    return this.http.post<Recommendation>(`${this.base}/recommendations/${id}/reject`, { reason });
  }

  // ---- enforcements
  enforcements(): Observable<Enforcement[]> { return this.http.get<Enforcement[]>(`${this.base}/enforcements`); }
  enforcement(id: number): Observable<Enforcement> { return this.http.get<Enforcement>(`${this.base}/enforcements/${id}`); }
  revert(id: number, reason: string): Observable<Enforcement> { return this.http.post<Enforcement>(`${this.base}/enforcements/${id}/revert`, { reason }); }
  injectRegression(id: number): Observable<Enforcement> { return this.http.post<Enforcement>(`${this.base}/enforcements/${id}/inject-regression`, {}); }

  // ---- policy
  policy(): Observable<PolicyConfig> { return this.http.get<PolicyConfig>(`${this.base}/policy`); }
  updatePolicy(p: PolicyConfig): Observable<PolicyConfig> { return this.http.put<PolicyConfig>(`${this.base}/policy`, p); }

  // ---- audit
  audit(type: string | null, recommendationId: number | null, page: number, size: number): Observable<PageResponse<AuditEvent>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (type) { params = params.set('type', type); }
    if (recommendationId != null) { params = params.set('recommendationId', recommendationId); }
    return this.http.get<PageResponse<AuditEvent>>(`${this.base}/audit`, { params });
  }
  verifyAudit(): Observable<VerifyResult> { return this.http.get<VerifyResult>(`${this.base}/audit/verify`); }
}

// Pure helpers live in utils.ts (unit-tested); re-exported so pages keep importing them from here.
export { errorMessage, parseJson } from './utils';
