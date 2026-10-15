import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, of, switchMap, timer } from 'rxjs';
import { ApiService, errorMessage, parseJson } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Enforcement, LiveKpi } from '../core/models';
import { NumPipe, PctPipe } from '../shared/pct.pipe';
import { StatusBadgeComponent } from '../shared/status-badge.component';

@Component({
  selector: 'app-enforcements',
  standalone: true,
  imports: [DatePipe, RouterLink, StatusBadgeComponent, PctPipe, NumPipe],
  template: `
    <h1>Enforcements (applied actions)</h1>
    <p class="muted small">Every action is applied through OpenDaylight, then monitored. Consecutive KPI regressions
      trigger automatic rollback; after the monitoring window the action is VERIFIED and kept.</p>
    @if (error) { <div class="alert error">{{ error }}</div> }
    @if (info) { <div class="alert info">{{ info }}</div> }
    <div class="panel">
      <table>
        <tr><th>#</th><th>Recommendation</th><th>Action</th><th>Status</th><th>Samples</th><th>Baseline → last</th><th>Outcome</th><th></th></tr>
        @for (e of list; track e.id) {
          <tr>
            <td>{{ e.id }}</td>
            <td><a [routerLink]="['/recommendations', e.recommendationId]">#{{ e.recommendationId }}</a></td>
            <td>{{ e.actionType }} · {{ e.trafficClass }}<div class="small muted">{{ e.startedAt | date:'dd MMM HH:mm:ss' }} by {{ e.appliedBy }}</div></td>
            <td><app-status [value]="e.status" />
              @if (e.regressionInjected) { <span class="badge warn">demo regression</span> }</td>
            <td>{{ e.samplesTaken }} ({{ e.consecutiveRegressions }} regr.)</td>
            <td class="small">
              @if (kpi(e.baselineKpiJson); as b) {
                max {{ b.maxLinkUtil | pct }} / {{ b.avgLatencyMs | num:1 }} ms
              }
              @if (kpi(e.lastKpiJson); as l) {
                → max {{ l.maxLinkUtil | pct }} / {{ l.avgLatencyMs | num:1 }} ms
              }
            </td>
            <td class="small">{{ e.endReason || e.lastRegression || (e.monitorUntil ? 'monitoring until ' + (e.monitorUntil | date:'HH:mm:ss') : '') }}</td>
            <td>
              @if (auth.isAdmin() && (e.status === 'MONITORING' || e.status === 'VERIFIED')) {
                <button (click)="revert(e)">Revert</button>
              }
              @if (auth.isAdmin() && e.status === 'MONITORING' && !e.regressionInjected) {
                <button (click)="inject(e)" title="Demo only: forces the monitor to see a regression">Inject regression (demo)</button>
              }
            </td>
          </tr>
        }
      </table>
      @if (list.length === 0) { <p class="muted">No actions applied yet.</p> }
    </div>`
})
export class EnforcementsComponent implements OnInit {
  list: Enforcement[] = [];
  error = '';
  info = '';

  constructor(private api: ApiService, public auth: AuthService, private destroyRef: DestroyRef) {}

  ngOnInit(): void {
    timer(0, 5000).pipe(
      switchMap(() => this.api.enforcements().pipe(catchError(err => { this.error = errorMessage(err); return of(null); }))),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(l => { if (l) { this.list = l; this.error = ''; } });
  }

  kpi(json: string | null): LiveKpi | null {
    return parseJson<LiveKpi | null>(json, null);
  }

  revert(e: Enforcement): void {
    const reason = prompt('Reason for reverting this action?', '') ?? '';
    this.api.revert(e.id, reason).subscribe({
      next: () => this.info = `Enforcement #${e.id} reverted.`,
      error: err => this.error = errorMessage(err)
    });
  }

  inject(e: Enforcement): void {
    if (!confirm('DEMO: make the monitor detect a regression so automatic rollback can be shown?')) { return; }
    this.api.injectRegression(e.id).subscribe({
      next: () => this.info = 'Synthetic regression injected (clearly labelled in the audit log).',
      error: err => this.error = errorMessage(err)
    });
  }
}
