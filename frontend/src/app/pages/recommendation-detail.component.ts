import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, of, switchMap, timer } from 'rxjs';
import { ApiService, errorMessage, parseJson } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import {
  AuditEvent, Counterfactual, Factor, KpiSummary, Recommendation, RecommendationCandidate, RecommendationView
} from '../core/models';
import { jsonEntries, needsRefresh } from '../core/utils';
import { NumPipe, PctPipe } from '../shared/pct.pipe';
import { StatusBadgeComponent } from '../shared/status-badge.component';

@Component({
  selector: 'app-recommendation-detail',
  standalone: true,
  imports: [DatePipe, DecimalPipe, NgTemplateOutlet, PctPipe, NumPipe, StatusBadgeComponent, FormsModule, RouterLink],
  template: `
    <div class="row"><a routerLink="/recommendations">&larr; Recommendations</a></div>
    @if (error) { <div class="alert error">{{ error }}</div> }
    @if (info) { <div class="alert info">{{ info }}</div> }
    @if (rec; as r) {
      <h1>Recommendation #{{ r.id }} <app-status [value]="r.status" /></h1>
      <p class="muted small">Created {{ r.createdAt | date:'dd MMM HH:mm:ss' }} · link {{ r.targetLinkId }} ·
        approval mode {{ r.approvalMode }}
        @if (r.expiresAt && r.status === 'PENDING_APPROVAL') { · expires {{ r.expiresAt | date:'HH:mm:ss' }} }
        @if (r.enforcementId) { · <a routerLink="/enforcements">enforcement #{{ r.enforcementId }}</a> }</p>
      @if (r.status === 'SIMULATING') {
        <div class="alert info">Candidates are being simulated in the Mininet digital twin (about 10 s per candidate)…</div>
      }
      @if (r.failureReason) { <div class="alert error">{{ r.failureReason }}</div> }
      @if (r.autoApprovalNote) { <div class="alert warn">{{ r.autoApprovalNote }}</div> }

      <div class="panel">
        <h2>1 · Prediction (why action is needed)</h2>
        <p>{{ r.factualExplanation }}</p>
        <div class="grid grid-2">
          <div>
            <h3>Contributing factors</h3>
            <table>
              @for (x of factors; track x.name) {
                <tr><td>{{ x.name }}</td><td>{{ x.contribution * 100 | number:'1.0-1' }} pp</td></tr>
              }
            </table>
          </div>
          <div>
            <h3>Prediction counterfactuals</h3>
            @for (c of predCfs; track c.description) { <p class="small">• {{ c.description }}</p> }
          </div>
        </div>
      </div>

      @if (r.humanImpact) {
        <div class="panel">
          <h2>2 · Human impact</h2>
          <p class="pre">{{ r.humanImpact }}</p>
        </div>
      }

      @if (selected) {
        <div class="panel">
          <h2>3 · Recommended action vs alternative (validated in the digital twin)</h2>
          <div class="grid grid-2">
            <div class="panel card-selected">
              <b>Recommended</b> <app-status [value]="selected.status" />
              <p>{{ selected.description }}</p>
              <ng-container *ngTemplateOutlet="scoreBlock; context: { $implicit: selected }"></ng-container>
            </div>
            @if (alternative) {
              <div class="panel card-alt">
                <b>Alternative (not selected)</b> <app-status [value]="alternative.status" />
                <p>{{ alternative.description }}</p>
                <ng-container *ngTemplateOutlet="scoreBlock; context: { $implicit: alternative }"></ng-container>
              </div>
            }
          </div>
          <h3>Why this action</h3><p>{{ r.whySelected }}</p>
          <h3>Why not the alternative</h3><p>{{ r.whyNotAlternative }}</p>
          <h3>Decision counterfactual</h3><p>{{ r.counterfactual }}</p>

          <h3>Twin KPIs</h3>
          <table>
            <tr><th>KPI</th><th>Baseline (no action)</th><th>Recommended</th><th>Alternative</th></tr>
            <tr><td>Target link utilisation</td><td>{{ base?.targetLinkUtil | pct }}</td>
              <td>{{ kpiOf(selected)?.targetLinkUtil | pct }}</td><td>{{ kpiOf(alternative)?.targetLinkUtil | pct }}</td></tr>
            <tr><td>Busiest link utilisation</td><td>{{ base?.maxLinkUtil | pct }}</td>
              <td>{{ kpiOf(selected)?.maxLinkUtil | pct }}</td><td>{{ kpiOf(alternative)?.maxLinkUtil | pct }}</td></tr>
            <tr><td>Protected latency (ms)</td><td>{{ base?.protectedLatencyMs | num:1 }}</td>
              <td>{{ kpiOf(selected)?.protectedLatencyMs | num:1 }}</td><td>{{ kpiOf(alternative)?.protectedLatencyMs | num:1 }}</td></tr>
            <tr><td>Protected loss (%)</td><td>{{ base?.protectedLossPct | num:1 }}</td>
              <td>{{ kpiOf(selected)?.protectedLossPct | num:1 }}</td><td>{{ kpiOf(alternative)?.protectedLossPct | num:1 }}</td></tr>
            <tr><td>Protected delivered (Mbps)</td><td>{{ base?.protectedDeliveredMbps | num:1 }}</td>
              <td>{{ kpiOf(selected)?.protectedDeliveredMbps | num:1 }}</td><td>{{ kpiOf(alternative)?.protectedDeliveredMbps | num:1 }}</td></tr>
          </table>
        </div>
      } @else if (r.status === 'NO_ACTION_RECOMMENDED') {
        <div class="panel"><h2>No action recommended</h2><p>{{ r.whySelected }}</p></div>
      }

      @if (r.status === 'PENDING_APPROVAL' && auth.isAdmin()) {
        <div class="panel">
          <h2>4 · Administrator decision</h2>
          <label>Comment / reason <input [(ngModel)]="comment" placeholder="optional"></label>
          <div class="row" style="margin-top:12px">
            <button class="primary" (click)="approve(null)" [disabled]="busy">Approve recommended action</button>
            @if (alternative && alternative.status === 'SELECTABLE') {
              <button (click)="approve(alternative.id)" [disabled]="busy">Approve alternative instead</button>
            }
            <button class="danger" (click)="reject()" [disabled]="busy">Reject</button>
          </div>
        </div>
      }
      @if (r.decidedBy) {
        <p class="small muted">Decision: {{ r.status }} by {{ r.decidedBy }} at {{ r.decidedAt | date:'HH:mm:ss' }}
          {{ r.decisionComment ? '- ' + r.decisionComment : '' }}</p>
      }

      <div class="panel">
        <h2>All candidates</h2>
        <table>
          <tr><th>Rank</th><th>Action</th><th>Status</th><th>Raw improv.</th><th>KPI improv.</th><th>Risk</th><th>Confidence</th><th>Score</th></tr>
          @for (c of candidates; track c.id) {
            <tr [class.selected]="c.id === r.selectedCandidateId">
              <td>{{ c.rankNo }}</td><td>{{ c.description }}
                @if (c.note) { <div class="small muted">{{ c.note }}</div> }</td>
              <td><app-status [value]="c.status" /></td>
              <td>{{ c.rawImprovement | number:'1.3-3' }}</td><td>{{ c.kpiImprovement | number:'1.3-3' }}</td>
              <td>{{ c.risk | number:'1.3-3' }}</td><td>{{ c.confidence | number:'1.2-2' }}</td>
              <td><b>{{ c.score | number:'1.3-3' }}</b></td>
            </tr>
          }
        </table>
        <p class="small muted">Score = w1·KPIImprovement + w2·Confidence − w3·Risk with weights {{ r.weightsJson }}</p>
      </div>

      <div class="panel">
        <h2>Audit trail</h2>
        <table>
          @for (a of audit; track a.id) {
            <tr><td class="small">{{ a.ts | date:'HH:mm:ss' }}</td><td class="small">{{ a.type }}</td>
              <td class="small">{{ a.actor }}</td><td>{{ a.summary }}</td></tr>
          }
        </table>
      </div>
    }

    <ng-template #scoreBlock let-c>
      <table>
        <tr><td>Score</td><td><b>{{ c.score | number:'1.3-3' }}</b></td></tr>
        <tr><td>KPI improvement</td><td>{{ c.kpiImprovement | number:'1.3-3' }}</td></tr>
        <tr><td>Risk</td><td>{{ c.risk | number:'1.3-3' }}</td></tr>
        <tr><td>Confidence</td><td>{{ c.confidence | number:'1.2-2' }}</td></tr>
        @for (e of breakdown(c.riskBreakdownJson); track e.key) {
          <tr class="small muted"><td>risk · {{ e.key }}</td><td>{{ e.value | number:'1.3-3' }}</td></tr>
        }
        @for (e of breakdown(c.improvementBreakdownJson); track e.key) {
          <tr class="small muted"><td>gain · {{ e.key }}</td><td>{{ e.value | number:'1.3-3' }}</td></tr>
        }
      </table>
    </ng-template>`
})
export class RecommendationDetailComponent implements OnInit {
  rec: Recommendation | null = null;
  candidates: RecommendationCandidate[] = [];
  selected: RecommendationCandidate | null = null;
  alternative: RecommendationCandidate | null = null;
  base: KpiSummary | null = null;
  factors: Factor[] = [];
  predCfs: Counterfactual[] = [];
  audit: AuditEvent[] = [];
  comment = '';
  error = '';
  info = '';
  busy = false;
  private id = 0;
  private kpiCache = new Map<number, KpiSummary | null>();

  constructor(private route: ActivatedRoute, private api: ApiService, public auth: AuthService,
              private destroyRef: DestroyRef) {}

  ngOnInit(): void {
    this.id = Number(this.route.snapshot.paramMap.get('id'));
    timer(0, 4000).pipe(
      switchMap(() => this.api.recommendation(this.id).pipe(catchError(err => { this.error = errorMessage(err); return of(null); }))),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(v => {
      if (!v) { return; }
      if (needsRefresh(this.rec, v.recommendation)) {
        this.apply(v);
        this.loadAudit();
      }
    });
  }

  private apply(v: RecommendationView): void {
    this.error = '';
    this.rec = v.recommendation;
    this.candidates = v.candidates;
    this.kpiCache.clear();
    this.selected = v.candidates.find(c => c.id === v.recommendation.selectedCandidateId) ?? null;
    this.alternative = v.candidates.find(c => c.id === v.recommendation.alternativeCandidateId) ?? null;
    this.base = parseJson<KpiSummary | null>(v.recommendation.baselineKpiJson, null);
    this.factors = parseJson<Factor[]>(v.recommendation.predictionFactorsJson, []);
    this.predCfs = parseJson<Counterfactual[]>(v.recommendation.predictionCounterfactualsJson, []);
  }

  private loadAudit(): void {
    this.api.audit(null, this.id, 0, 100).subscribe({ next: p => this.audit = p.content, error: () => {} });
  }

  kpiOf(c: RecommendationCandidate | null): KpiSummary | null {
    if (!c) { return null; }
    if (!this.kpiCache.has(c.id)) { this.kpiCache.set(c.id, parseJson<KpiSummary | null>(c.twinKpiJson, null)); }
    return this.kpiCache.get(c.id) ?? null;
  }

  breakdown(json: string | null): { key: string; value: number }[] {
    return jsonEntries(json);
  }

  approve(candidateId: number | null): void {
    this.busy = true; this.info = ''; this.error = '';
    this.api.approve(this.id, candidateId, this.comment).subscribe({
      next: r => { this.busy = false; this.info = `Decision recorded. Status: ${r.status}`; this.rec = r; },
      error: err => { this.busy = false; this.error = errorMessage(err); }
    });
  }

  reject(): void {
    this.busy = true; this.info = ''; this.error = '';
    this.api.reject(this.id, this.comment).subscribe({
      next: r => { this.busy = false; this.info = 'Rejected.'; this.rec = r; },
      error: err => { this.busy = false; this.error = errorMessage(err); }
    });
  }
}
