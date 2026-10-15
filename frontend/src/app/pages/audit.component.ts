import { DatePipe } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { AuditEvent, VerifyResult } from '../core/models';
import { normaliseAuditFilter } from '../core/utils';

@Component({
  selector: 'app-audit',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <h1>Audit log</h1>
    @if (error) { <div class="alert error">{{ error }}</div> }
    <div class="panel row">
      <label>Type <input [(ngModel)]="type" placeholder="e.g. APPROVED"></label>
      <label>Recommendation # <input type="number" [(ngModel)]="recId"></label>
      <button (click)="page = 0; load()">Filter</button>
      <span class="spacer"></span>
      <button (click)="verify()">Verify hash chain</button>
      @if (verifyResult) {
        <span class="badge" [class.ok]="verifyResult.valid" [class.bad]="!verifyResult.valid">
          {{ verifyResult.message }} ({{ verifyResult.checked }} entries)</span>
      }
    </div>
    <div class="panel">
      <table>
        <tr><th>#</th><th>Time</th><th>Type</th><th>Actor</th><th>Rec</th><th>Summary</th></tr>
        @for (a of rows; track a.id) {
          <tr class="clickable" (click)="open = open === a.id ? null : a.id">
            <td>{{ a.id }}</td><td class="small">{{ a.ts | date:'dd MMM HH:mm:ss' }}</td>
            <td class="small">{{ a.type }}</td><td class="small">{{ a.actor }}</td>
            <td>@if (a.recommendationId) { <a [routerLink]="['/recommendations', a.recommendationId]" (click)="$event.stopPropagation()">#{{ a.recommendationId }}</a> }</td>
            <td>{{ a.summary }}
              @if (open === a.id) {
                <div class="mono pre small">{{ a.details }}</div>
                <div class="mono small muted">hash {{ a.hash }}</div>
              }
            </td>
          </tr>
        }
      </table>
      <div class="row" style="margin-top:8px">
        <button (click)="prev()" [disabled]="page === 0">Previous</button>
        <span class="small">page {{ page + 1 }} / {{ totalPages || 1 }}</span>
        <button (click)="next()" [disabled]="page + 1 >= totalPages">Next</button>
      </div>
    </div>`
})
export class AuditComponent implements OnInit {
  rows: AuditEvent[] = [];
  type = '';
  recId: number | null = null;
  page = 0;
  totalPages = 0;
  open: number | null = null;
  verifyResult: VerifyResult | null = null;
  error = '';

  constructor(private api: ApiService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    const f = normaliseAuditFilter(this.type, this.recId);
    this.api.audit(f.type, f.recommendationId, this.page, 50).subscribe({
      next: p => { this.rows = p.content; this.totalPages = p.totalPages; this.error = ''; },
      error: err => this.error = errorMessage(err)
    });
  }

  prev(): void { if (this.page > 0) { this.page--; this.load(); } }
  next(): void { if (this.page + 1 < this.totalPages) { this.page++; this.load(); } }

  verify(): void {
    this.api.verifyAudit().subscribe({ next: v => this.verifyResult = v, error: err => this.error = errorMessage(err) });
  }
}
