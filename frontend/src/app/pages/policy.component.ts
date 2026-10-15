import { DatePipe } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { PolicyConfig } from '../core/models';
import { coercePolicy } from '../core/policy-form';

@Component({
  selector: 'app-policy',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <h1>Policy</h1>
    @if (error) { <div class="alert error">{{ error }}</div> }
    @if (info) { <div class="alert info">{{ info }}</div> }
    @if (p) {
      <fieldset [disabled]="!auth.isAdmin()" style="border:0;padding:0;margin:0">
        <div class="panel">
          <h2>Approval</h2>
          <div class="form-grid">
            <label>Approval mode
              <select [(ngModel)]="p.approvalMode">
                <option value="MANUAL">MANUAL - administrator approves every action</option>
                <option value="AUTO_LOW_RISK">AUTO_LOW_RISK - policy may approve low-risk actions</option>
              </select>
            </label>
            <label>Auto: max risk <input type="number" step="0.01" [(ngModel)]="p.autoMaxRisk"></label>
            <label>Auto: min score <input type="number" step="0.01" [(ngModel)]="p.autoMinScore"></label>
            <label>Auto: min confidence <input type="number" step="0.01" [(ngModel)]="p.autoMinConfidence"></label>
            <label>Auto: allowed actions (CSV) <input [(ngModel)]="p.autoAllowedActions" placeholder="REROUTE,RATE_LIMIT"></label>
            <label>Auto: max approvals per hour <input type="number" [(ngModel)]="p.autoMaxPerHour"></label>
            <label>Recommendation TTL (min) <input type="number" [(ngModel)]="p.recommendationTtlMinutes"></label>
          </div>
        </div>
        <div class="panel">
          <h2>Scoring - Score = w1·KPIImprovement + w2·Confidence − w3·Risk</h2>
          <div class="form-grid">
            <label>w1 improvement <input type="number" step="0.05" [(ngModel)]="p.weightImprovement"></label>
            <label>w2 confidence <input type="number" step="0.05" [(ngModel)]="p.weightConfidence"></label>
            <label>w3 risk <input type="number" step="0.05" [(ngModel)]="p.weightRisk"></label>
            <label>Min raw improvement to be selectable <input type="number" step="0.01" [(ngModel)]="p.minImprovement"></label>
            <label>Max candidates (1-5) <input type="number" [(ngModel)]="p.maxCandidates"></label>
            <label>Rate-limit fraction of demand <input type="number" step="0.05" [(ngModel)]="p.rateLimitFraction"></label>
          </div>
        </div>
        <div class="panel">
          <h2>Congestion detection</h2>
          <div class="form-grid">
            <label>Utilisation threshold <input type="number" step="0.01" [(ngModel)]="p.congestionUtilThreshold"></label>
            <label>Risk threshold <input type="number" step="0.01" [(ngModel)]="p.congestionRiskThreshold"></label>
          </div>
        </div>
        <div class="panel">
          <h2>Monitoring &amp; rollback</h2>
          <div class="form-grid">
            <label>Monitoring window (s) <input type="number" [(ngModel)]="p.monitorWindowSec"></label>
            <label>Rollback if busiest-link util rises by (%) <input type="number" [(ngModel)]="p.rollbackUtilIncreasePct"></label>
            <label>Rollback if latency rises by (%) <input type="number" [(ngModel)]="p.rollbackLatencyIncreasePct"></label>
            <label>Rollback if probe loss exceeds (%) <input type="number" step="0.5" [(ngModel)]="p.rollbackLossPct"></label>
          </div>
        </div>
      </fieldset>
      <div class="row">
        @if (auth.isAdmin()) { <button class="primary" (click)="save()">Save policy</button> }
        <span class="muted small">Last updated {{ p.updatedAt | date:'dd MMM HH:mm:ss' }} by {{ p.updatedBy }}</span>
      </div>
    }`
})
export class PolicyComponent implements OnInit {
  p: PolicyConfig | null = null;
  error = '';
  info = '';

  constructor(private api: ApiService, public auth: AuthService) {}

  ngOnInit(): void {
    this.api.policy().subscribe({ next: p => this.p = p, error: err => this.error = errorMessage(err) });
  }

  save(): void {
    if (!this.p) { return; }
    this.error = ''; this.info = '';
    this.api.updatePolicy(coercePolicy(this.p)).subscribe({
      next: p => { this.p = p; this.info = 'Policy saved (recorded in the audit log).'; },
      error: err => this.error = errorMessage(err)
    });
  }
}
