import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap, timer } from 'rxjs';
import { ApiService, errorMessage } from '../core/api.service';
import { TelemetrySnapshot } from '../core/models';
import { PctPipe } from '../shared/pct.pipe';
import { SparklineComponent } from '../shared/sparkline.component';

@Component({
  selector: 'app-telemetry',
  standalone: true,
  imports: [PctPipe, DecimalPipe, DatePipe, SparklineComponent],
  template: `
    <h1>Telemetry</h1>
    @if (error) { <div class="alert error">{{ error }}</div> }
    @if (snap) {
      <p class="muted small">Source {{ snap.source }} · last sample {{ snap.polledAt ? (snap.polledAt | date:'HH:mm:ss') : '—' }}
        @if (snap.stale) { <span class="badge warn">stale</span> }
        @if (snap.lastError) { · <span class="badge bad">{{ snap.lastError }}</span> }</p>
      <div class="grid grid-2">
        <div class="panel">
          <h2>Links (click for history)</h2>
          <table>
            <tr><th>Link</th><th>Utilisation</th><th>Mbps</th><th>Capacity</th></tr>
            @for (l of snap.links; track l.linkId) {
              <tr class="clickable" [class.selected]="l.linkId === selected" (click)="select(l.linkId)">
                <td>{{ l.linkId }}</td><td>{{ l.utilization | pct }}</td>
                <td>{{ l.mbps | number:'1.2-2' }}</td><td>{{ l.capacityMbps }} Mbps</td>
              </tr>
            }
          </table>
        </div>
        <div class="panel">
          <h2>History {{ selected ? '- ' + selected : '' }} (last 30 min)</h2>
          @if (selected) {
            <app-sparkline [values]="history" [max]="1" [threshold]="0.8" [label]="history.length + ' samples'" />
          } @else {
            <p class="muted">Select a link.</p>
          }
          <h3>Host-group demand</h3>
          <table>
            <tr><th>Group</th><th>Mbps delivered</th><th>of uplink</th></tr>
            @for (g of snap.groups; track g.group) {
              <tr><td>{{ g.group }}</td><td>{{ g.mbps | number:'1.2-2' }}</td><td>{{ g.utilization | pct }}</td></tr>
            }
          </table>
        </div>
      </div>
    }`
})
export class TelemetryComponent implements OnInit {
  snap: TelemetrySnapshot | null = null;
  selected: string | null = null;
  history: number[] = [];
  error = '';

  constructor(private api: ApiService, private destroyRef: DestroyRef) {}

  ngOnInit(): void {
    timer(0, 10000).pipe(
      switchMap(() => this.api.telemetryLatest().pipe(catchError(err => { this.error = errorMessage(err); return of(null); }))),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(s => {
      if (s) { this.snap = s; this.error = ''; }
      if (this.selected) { this.loadHistory(); }
    });
  }

  select(linkId: string): void {
    this.selected = linkId;
    this.loadHistory();
  }

  private loadHistory(): void {
    const id = this.selected;
    if (!id) { return; }
    this.api.telemetryHistory('LINK', id, 30).subscribe({
      next: rows => { if (this.selected === id) { this.history = rows.map(r => r.utilization); } },
      error: err => this.error = errorMessage(err)
    });
  }
}
