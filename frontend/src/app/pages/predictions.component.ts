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
        <p class="small muted">Click a row to see why the model forecast that value.</p>
        <table>
          <tr><th>Link</th><th>Horizon</th><th>Predicted</th><th>Range</th><th>Risk</th><th>Confidence</th><th>Source</th></tr>
          @for (f of r.forecasts; track f.linkId + '-' + f.horizonMinutes) {
            <tr class="clickable" [class.selected]="f === selected" (click)="select(f)">
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
        <h2>Explanation - {{ selected.linkId }} in {{ selected.horizonMinutes }} min
          @if (selected.source.startsWith('ML')) { <span class="badge ok">SHAP</span> }
        </h2>
        <p><b>{{ summary(selected) }}</b></p>

        <h3>Factual (what drives this forecast)</h3>
        <p class="small muted">Each bar is how many percentage points (pp) the factor adds (orange, right) or removes (blue, left) compared with a neutral baseline.</p>
        <table>
          <tr><th>Factor</th><th>Effect</th><th style="width:34%"></th><th>Description</th></tr>
          @for (x of sortedFactors(selected); track x.name) {
            <tr>
              <td>{{ label(x.name) }}</td>
              <td>{{ x.contribution >= 0 ? '+' : '' }}{{ x.contribution * 100 | number:'1.0-1' }} pp</td>
              <td>
                <div style="position:relative;height:14px;background:#f0f2f5;border-radius:3px">
                  <div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:#b0b7c3"></div>
                  <div style="position:absolute;top:2px;bottom:2px;border-radius:2px"
                       [style.left]="x.contribution >= 0 ? '50%' : null"
                       [style.right]="x.contribution < 0 ? '50%' : null"
                       [style.width]="barWidth(x.contribution, selected)"
                       [style.background]="x.contribution >= 0 ? '#e67e22' : '#2980b9'"></div>
                </div>
              </td>
              <td class="small">{{ x.description }}</td>
            </tr>
          }
        </table>

        <h3>Counterfactual (what would change this forecast)</h3>
        @for (c of selected.counterfactuals; track c.description) { <p>• {{ c.description }}</p> }
        @if (selected.source.startsWith('ML')) {
          <div class="row">
            <label class="small">Target utilisation
              <input type="number" min="0" max="1" step="0.05" style="width:80px"
                     [value]="cfTarget" (input)="cfTarget = +$any($event.target).value">
            </label>
            <button (click)="whatIf()" [disabled]="cfBusy">What would fix this?</button>
          </div>
          @if (cfError) { <div class="alert error">{{ cfError }}</div> }
          @if (cf) {
            @if (cf.length === 0) { <p class="muted">No suggestions found.</p> }
            @for (c of cf; track c.description) {
              <p>• {{ c.description }} → <b>{{ c.predictedUtilization | pct }}</b></p>
            }
            <p class="small muted">What-if on the model with the current live data. It shows how the forecast would change, not a guaranteed outcome.</p>
          }
        } @else {
          @if (selected.counterfactuals.length === 0) { <p class="muted">None.</p> }
        }
      </div>
    }`
})
export class PredictionsComponent implements OnInit {
  run$: ForecastRun | null = null;
  selected: LinkForecast | null = null;
  ml: Record<string, any> | null = null;
  error = '';
  busy = false;

  cfTarget = 0.7;
  cfBusy = false;
  cfError = '';
  cf: { description: string; predictedUtilization: number }[] | null = null;

  private readonly labels: Record<string, string> = {
    recentUtilization: 'Current load',
    timeOfDay: 'Time of day',
    recentBaseline: 'Recent baseline',
    trend: 'Trend',
    'scenario-override': 'Demo scenario override'
  };

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
      next: r => { this.busy = false; this.run$ = r; this.select(null); },
      error: err => { this.busy = false; this.error = errorMessage(err); }
    });
  }

  setProvider(p: string): void {
    this.api.setProvider(p).subscribe({ next: () => this.load(), error: err => this.error = errorMessage(err) });
  }

  select(f: LinkForecast | null): void {
    this.selected = f;
    this.cf = null;
    this.cfError = '';
    if (f) {
      // default target: 10 points below the forecast, but never above 70%
      this.cfTarget = Math.max(0.05, Math.round(Math.min(0.7, f.predictedUtilization - 0.1) * 20) / 20);
    }
  }

  whatIf(): void {
    const f = this.selected;
    if (!f) { return; }
    this.cf = null;
    this.cfError = '';
    if (f.predictedUtilization <= this.cfTarget) {
      this.cfError = `Already forecast at ${(f.predictedUtilization * 100).toFixed(0)}%, which is at or below the ${(this.cfTarget * 100).toFixed(0)}% target. Lower the target to see options.`;
      return;
    }
    this.cfBusy = true;
    this.api.counterfactuals(f.linkId, f.horizonMinutes, this.cfTarget).subscribe({
      next: r => { this.cfBusy = false; this.cf = r.counterfactuals ?? []; },
      error: err => { this.cfBusy = false; this.cfError = errorMessage(err); }
    });
  }

  label(name: string): string {
    if (this.labels[name]) { return this.labels[name]; }
    if (name.startsWith('event:')) {
      const t = name.substring(6).toLowerCase().replace(/_/g, ' ');
      return t.charAt(0).toUpperCase() + t.slice(1) + ' event';
    }
    return name;
  }

  sortedFactors(f: LinkForecast) {
    return [...f.factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  }

  barWidth(contribution: number, f: LinkForecast): string {
    const max = Math.max(0.001, ...f.factors.map(x => Math.abs(x.contribution)));
    return (Math.abs(contribution) / max) * 50 + '%';
  }

  summary(f: LinkForecast): string {
    const base = `Forecast ${(f.predictedUtilization * 100).toFixed(0)}% at +${f.horizonMinutes} min`;
    const top = this.sortedFactors(f)[0];
    if (!top) { return base + '.'; }
    const pp = top.contribution * 100;
    return `${base}. Main driver: ${this.label(top.name)} (${pp >= 0 ? '+' : ''}${pp.toFixed(1)} pp).`;
  }
}