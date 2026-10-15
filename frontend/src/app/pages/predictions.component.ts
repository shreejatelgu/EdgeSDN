import { DatePipe, DecimalPipe, JsonPipe } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ForecastRun, LinkForecast } from '../core/models';
import { PctPipe } from '../shared/pct.pipe';

@Component({
  selector: 'app-predictions',
  standalone: true,
  imports: [PctPipe, DecimalPipe, DatePipe, JsonPipe],
  template: `
    <h1>Predictions</h1>
    @if (error) { <div class="alert error">{{ error }}</div> }

    <div class="panel">
      <div class="row">
        <h2 style="margin:0">Prediction provider</h2><span class="spacer"></span>
        @if (auth.isAdmin()) {
          <button (click)="setProvider('RULE_BASED')">Use RULE_BASED</button>
          <button (click)="setProvider('ML')">Use ML service</button>
          <button class="primary" (click)="run()" [disabled]="busy">Run forecast now</button>
        }
      </div>
      @if (ml) {
        <p class="small">Active: <b>{{ ml['activeProvider'] }}</b> ·
          ML service {{ ml['mlBaseUrl'] }}:
          @if (ml['reachable']) { <span class="badge ok">reachable</span> } @else { <span class="badge bad">unreachable</span> }
          · fallback to RULE_BASED: {{ ml['fallbackToRuleBased'] }}</p>
        @if (ml['modelInfo']) { <p class="small mono">{{ ml['modelInfo'] | json }}</p> }
      }
    </div>

    @if (run$; as r) {
      <div class="panel">
        <h2>Latest run · {{ r.generatedAt | date:'HH:mm:ss' }} · {{ r.provider }}</h2>
        @if (r.fallbackUsed) { <div class="alert warn">Fallback used: {{ r.fallbackReason }}</div> }
        <table>
          <tr><th>Link</th><th>Horizon</th><th>Predicted</th><th>Range</th><th>Risk</th><th>Confidence</th><th>Source</th></tr>
          @for (f of r.forecasts; track f.linkId + '-' + f.horizonMinutes) {
            <tr class="clickable" [class.selected]="f === selected" (click)="selected = f">
              <td>{{ f.linkId }}</td><td>{{ f.horizonMinutes }} min</td>
              <td [style.color]="f.predictedUtilization >= 0.8 ? '#c0392b' : null"><b>{{ f.predictedUtilization | pct }}</b></td>
              <td>{{ f.lower | pct }} - {{ f.upper | pct }}</td>
              <td>{{ f.congestionRisk | number:'1.2-2' }}</td><td>{{ f.confidence | pct }}</td>
              <td class="small">{{ f.source }}</td>
            </tr>
          }
        </table>
      </div>
    } @else {
      <p class="muted">No forecast yet (the first scheduled run starts about 45 s after the backend boots).</p>
    }

    @if (selected) {
      <div class="panel">
        <h2>Explanation - {{ selected.linkId }} in {{ selected.horizonMinutes }} min</h2>
        <h3>Factual (contributing factors)</h3>
        <table>
          <tr><th>Factor</th><th>Contribution</th><th>Description</th></tr>
          @for (x of selected.factors; track x.name) {
            <tr><td>{{ x.name }}</td><td>{{ x.contribution >= 0 ? '+' : '' }}{{ x.contribution * 100 | number:'1.0-1' }} pp</td><td>{{ x.description }}</td></tr>
          }
        </table>
        <h3>Counterfactual</h3>
        @for (c of selected.counterfactuals; track c.description) { <p>• {{ c.description }}</p> }
        @if (selected.counterfactuals.length === 0) { <p class="muted">None.</p> }
      </div>
    }`
})
export class PredictionsComponent implements OnInit {
  run$: ForecastRun | null = null;
  selected: LinkForecast | null = null;
  ml: Record<string, any> | null = null;
  error = '';
  busy = false;

  constructor(private api: ApiService, public auth: AuthService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.api.latestForecast().subscribe({ next: r => this.run$ = r, error: err => this.error = errorMessage(err) });
    this.api.mlStatus().subscribe({ next: m => this.ml = m, error: () => this.ml = null });
  }

  run(): void {
    this.busy = true;
    this.api.runForecast().subscribe({
      next: r => { this.busy = false; this.run$ = r; this.selected = null; },
      error: err => { this.busy = false; this.error = errorMessage(err); }
    });
  }

  setProvider(p: string): void {
    this.api.setProvider(p).subscribe({ next: () => this.load(), error: err => this.error = errorMessage(err) });
  }
}
