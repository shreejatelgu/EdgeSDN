import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, of, switchMap, timer } from 'rxjs';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Recommendation } from '../core/models';
import { PctPipe } from '../shared/pct.pipe';
import { StatusBadgeComponent } from '../shared/status-badge.component';

@Component({
  selector: 'app-recommendations',
  standalone: true,
  imports: [RouterLink, DatePipe, PctPipe, StatusBadgeComponent, FormsModule],
  template: `
    <h1>Recommendations</h1>
    @if (error) { <div class="alert error">{{ error }}</div> }
    @if (info) { <div class="alert info">{{ info }}</div> }
    <div class="panel row">
      <label>Status filter
        <select [(ngModel)]="status" (ngModelChange)="refresh()">
          <option value="">all</option>
          @for (s of statuses; track s) { <option [value]="s">{{ s }}</option> }
        </select>
      </label>
      <span class="spacer"></span>
      @if (auth.isAdmin()) {
        <button class="primary" (click)="evaluate()">Evaluate network now</button>
      }
    </div>
    <div class="panel">
      <table>
        <tr><th>#</th><th>Created</th><th>Link</th><th>Predicted</th><th>Source</th><th>Status</th><th>Decided by</th></tr>
        @for (r of recs; track r.id) {
          <tr>
            <td><a [routerLink]="['/recommendations', r.id]">#{{ r.id }}</a></td>
            <td>{{ r.createdAt | date:'dd MMM HH:mm:ss' }}</td>
            <td>{{ r.targetLinkId }}</td>
            <td>{{ r.predictedUtilization | pct }} in {{ r.horizonMinutes }} min</td>
            <td class="small">{{ r.predictionSource }}</td>
            <td><app-status [value]="r.status" /></td>
            <td class="small">{{ r.decidedBy || '—' }}</td>
          </tr>
        }
      </table>
      @if (recs.length === 0) { <p class="muted">No recommendations yet.</p> }
    </div>`
})
export class RecommendationsComponent implements OnInit {
  recs: Recommendation[] = [];
  status = '';
  statuses = ['SIMULATING', 'PENDING_APPROVAL', 'APPROVED', 'AUTO_APPROVED', 'REJECTED', 'EXPIRED',
    'NO_ACTION_RECOMMENDED', 'APPLYING', 'MONITORING', 'VERIFIED', 'ROLLED_BACK', 'REVERTED', 'FAILED'];
  error = '';
  info = '';

  constructor(private api: ApiService, public auth: AuthService, private destroyRef: DestroyRef) {}

  ngOnInit(): void {
    timer(0, 5000).pipe(
      switchMap(() => this.api.recommendations(this.status || undefined)
        .pipe(catchError(err => { this.error = errorMessage(err); return of(null); }))),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(r => { if (r) { this.recs = r; this.error = ''; } });
  }

  refresh(): void {
    this.api.recommendations(this.status || undefined).subscribe({ next: r => this.recs = r, error: err => this.error = errorMessage(err) });
  }

  evaluate(): void {
    this.info = '';
    this.api.evaluateNow().subscribe({
      next: r => { this.info = `Forecast run ${r['runId']} (${r['provider']}) done; a recommendation starts if congestion is predicted.`; this.refresh(); },
      error: err => this.error = errorMessage(err)
    });
  }
}
