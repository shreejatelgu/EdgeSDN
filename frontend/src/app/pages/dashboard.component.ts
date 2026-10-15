import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, of, switchMap, timer } from 'rxjs';
import { ApiService, errorMessage } from '../core/api.service';
import { DashboardView } from '../core/models';
import { PctPipe } from '../shared/pct.pipe';
import { StatusBadgeComponent } from '../shared/status-badge.component';
import { TopologyViewComponent } from '../shared/topology-view.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [TopologyViewComponent, StatusBadgeComponent, PctPipe, DatePipe, DecimalPipe, RouterLink],
  template: `
    <h1>Dashboard</h1>
    @if (error) { <div class="alert error">{{ error }}</div> }
    @if (d) {
      @if (!d.topologyLoaded) {
        <div class="alert warn">Topology not loaded: {{ d.topologyError }}. Is the twin-agent running?</div>
      }
      @if (d.telemetryStale) {
        <div class="alert warn">Telemetry is stale{{ d.telemetryError ? ': ' + d.telemetryError : '' }}</div>
      }
      <div class="grid grid-3">
        <div class="panel kpi"><span class="value">{{ d.openRecommendations.length }}</span><span class="label">open recommendations</span></div>
        <div class="panel kpi"><span class="value">{{ d.activeEnforcements.length }}</span><span class="label">active actions</span></div>
        <div class="panel kpi"><span class="value">{{ d.approvalMode }}</span><span class="label">approval mode</span></div>
        <div class="panel kpi"><span class="value" style="font-size:16px">{{ d.provider }}</span>
          <span class="label">forecast {{ d.forecastAt ? (d.forecastAt | date:'HH:mm:ss') : 'not run yet' }}</span></div>
        <div class="panel kpi"><span class="value" style="font-size:16px">{{ d.telemetryAt ? (d.telemetryAt | date:'HH:mm:ss') : '—' }}</span>
          <span class="label">last telemetry sample</span></div>
      </div>

      <div class="panel">
        <h2>Campus topology (live utilisation)</h2>
        <app-topology-view [topology]="d.topology" [links]="d.links" [highlightLink]="highlight" />
      </div>

      <div class="grid grid-2">
        <div class="panel">
          <h2>Open recommendations</h2>
          @if (d.openRecommendations.length === 0) { <p class="muted">None.</p> }
          <table>
            @for (r of d.openRecommendations; track r.id) {
              <tr>
                <td><a [routerLink]="['/recommendations', r.id]">#{{ r.id }}</a></td>
                <td>{{ r.targetLinkId }}</td>
                <td>{{ r.predictedUtilization | pct }} in {{ r.horizonMinutes }} min</td>
                <td><app-status [value]="r.status" /></td>
              </tr>
            }
          </table>
        </div>
        <div class="panel">
          <h2>Active actions</h2>
          @if (d.activeEnforcements.length === 0) { <p class="muted">None - baseline routing only.</p> }
          <table>
            @for (e of d.activeEnforcements; track e.id) {
              <tr>
                <td>#{{ e.id }}</td><td>{{ e.actionType }}</td><td>{{ e.trafficClass }}</td>
                <td><app-status [value]="e.status" /></td>
              </tr>
            }
          </table>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="panel">
          <h2>Links</h2>
          <table>
            <tr><th>Link</th><th>Now</th><th>Mbps</th><th>Predicted peak</th><th>Risk</th></tr>
            @for (l of d.links; track l.id) {
              <tr>
                <td>{{ l.id }}</td>
                <td>{{ l.utilization | pct }}</td>
                <td>{{ l.mbps === null ? '—' : (l.mbps | number:'1.1-1') }}</td>
                <td>{{ l.predictedPeak | pct }} {{ l.peakHorizon ? '(' + l.peakHorizon + ' min)' : '' }}</td>
                <td>{{ l.risk === null ? '—' : (l.risk | number:'1.2-2') }}</td>
              </tr>
            }
          </table>
        </div>
        <div class="panel">
          <h2>Traffic delivered to host groups</h2>
          <table>
            <tr><th>Group</th><th>Mbps</th></tr>
            @for (g of d.groups; track g.group) {
              <tr><td>{{ g.group }}</td><td>{{ g.mbps | number:'1.1-1' }}</td></tr>
            }
          </table>
        </div>
      </div>
    } @else if (!error) {
      <p class="muted">Loading…</p>
    }`
})
export class DashboardComponent implements OnInit {
  d: DashboardView | null = null;
  error = '';

  constructor(private api: ApiService, private destroyRef: DestroyRef) {}

  get highlight(): string | null {
    return this.d && this.d.openRecommendations.length ? this.d.openRecommendations[0].targetLinkId : null;
  }

  ngOnInit(): void {
    timer(0, 5000).pipe(
      switchMap(() => this.api.dashboard().pipe(catchError(err => { this.error = errorMessage(err); return of(null); }))),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(d => { if (d) { this.d = d; this.error = ''; } });
  }
}
