import { DatePipe, JsonPipe } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { DEFAULT_CLASS_DEMAND, defaultScenarioLink, positiveDemands, presetDemands, scenarioRequest } from '../core/demo-helpers';
import { ScenarioOverride, Topology } from '../core/models';

@Component({
  selector: 'app-control',
  standalone: true,
  imports: [FormsModule, JsonPipe, DatePipe],
  template: `
    <h1>Network &amp; demo control</h1>
    @if (error) { <div class="alert error">{{ error }}</div> }
    @if (info) { <div class="alert info">{{ info }}</div> }

    <div class="panel">
      <div class="row"><h2 style="margin:0">Status</h2><span class="spacer"></span>
        <button (click)="loadStatus()">Refresh</button>
        @if (auth.isAdmin()) {
          <button (click)="reloadTopology()">Reload topology from agent</button>
          <button class="primary" (click)="initNetwork()">(Re)initialise baseline routing</button>
        }
      </div>
      @if (status) { <pre class="mono small">{{ status | json }}</pre> }
    </div>

    @if (auth.isAdmin()) {
      <div class="grid grid-2">
        <div class="panel">
          <h2>Live demo traffic (real UDP load on the live Mininet network)</h2>
          <p class="muted small">Mbps delivered from the server farm to each group. Watch utilisation rise on the dashboard.</p>
          <div class="form-grid">
            @for (c of classes; track c) {
              <label>{{ c }} (Mbps) <input type="number" min="0" step="0.5" [(ngModel)]="demands[c]"></label>
            }
            <label>Duration (s) <input type="number" min="10" [(ngModel)]="duration"></label>
          </div>
          <div class="row" style="margin-top:12px">
            <button class="primary" (click)="startTraffic()">Start traffic</button>
            <button (click)="stopTraffic()">Stop traffic</button>
            <button (click)="preset()">Exam-surge preset</button>
          </div>
        </div>

        <div class="panel">
          <h2>Forecast override (demo scenario)</h2>
          <p class="muted small">Forces the next forecasts for a link; always labelled "DEMO SCENARIO" in explanations and audit.</p>
          <div class="form-grid">
            <label>Link
              <select [(ngModel)]="sc.linkId">
                @for (l of links; track l) { <option [value]="l">{{ l }}</option> }
              </select>
            </label>
            <label>Predicted utilisation (0-1.5) <input type="number" step="0.05" [(ngModel)]="sc.predictedUtilization"></label>
            <label>Confidence (0-1) <input type="number" step="0.05" [(ngModel)]="sc.confidence"></label>
            <label>Horizon (blank = all) <input type="number" [(ngModel)]="sc.horizonMinutes"></label>
            <label>Active for (min) <input type="number" [(ngModel)]="sc.durationMinutes"></label>
            <label>Note <input [(ngModel)]="sc.note"></label>
          </div>
          <div class="row" style="margin-top:12px">
            <button class="primary" (click)="addScenario()">Inject</button>
            <button (click)="clearScenarios()">Clear all</button>
            <button (click)="evaluate()">Evaluate now</button>
          </div>
          <table style="margin-top:12px">
            @for (s of scenarios; track s.id) {
              <tr><td>{{ s.linkId }}</td><td>{{ s.predictedUtilization * 100 }}%</td><td>h={{ s.horizonMinutes ?? 'all' }}</td>
                <td class="small">until {{ s.expiresAt | date:'HH:mm' }}</td>
                <td><button (click)="deleteScenario(s.id)">Remove</button></td></tr>
            }
          </table>
        </div>
      </div>
    }`
})
export class ControlComponent implements OnInit {
  status: Record<string, any> | null = null;
  classes: string[] = [];
  links: string[] = [];
  demands: Record<string, number> = {};
  duration = 600;
  scenarios: ScenarioOverride[] = [];
  sc = { linkId: '', predictedUtilization: 0.95, confidence: 0.85, horizonMinutes: null as number | null, durationMinutes: 30, note: 'exam surge demo' };
  error = '';
  info = '';

  constructor(private api: ApiService, public auth: AuthService) {}

  ngOnInit(): void {
    this.loadStatus();
    this.api.topology().subscribe({
      next: v => { if (v.topology) { this.applyTopology(v.topology); } },
      error: err => this.error = errorMessage(err)
    });
    this.loadScenarios();
  }

  private applyTopology(t: Topology): void {
    this.classes = t.groups.filter(g => !g.server).map(g => g.name);
    this.links = t.links.map(l => l.id);
    for (const c of this.classes) { this.demands[c] ??= DEFAULT_CLASS_DEMAND; }
    if (!this.sc.linkId) { this.sc.linkId = defaultScenarioLink(this.links); }
  }

  loadStatus(): void {
    this.api.networkStatus().subscribe({ next: s => this.status = s, error: err => this.error = errorMessage(err) });
  }

  loadScenarios(): void {
    this.api.scenarios().subscribe({ next: s => this.scenarios = s, error: () => {} });
  }

  reloadTopology(): void {
    this.api.reloadTopology().subscribe({
      next: v => { this.info = v.loaded ? 'Topology reloaded.' : 'Topology not loaded: ' + v.error; if (v.topology) { this.applyTopology(v.topology); } },
      error: err => this.error = errorMessage(err)
    });
  }

  initNetwork(): void {
    if (!confirm('Reset controller tables to baseline routing? Active actions will be marked REVERTED.')) { return; }
    this.api.initNetwork().subscribe({
      next: r => { this.info = 'Baseline routing programmed: ' + JSON.stringify(r); this.loadStatus(); },
      error: err => this.error = errorMessage(err)
    });
  }

  preset(): void {
    this.demands = { ...this.demands, ...presetDemands(this.classes) };
  }

  startTraffic(): void {
    this.error = ''; this.info = '';
    const d = positiveDemands(this.classes, this.demands);
    if (Object.keys(d).length === 0) { this.error = 'Enter a demand greater than 0 Mbps for at least one group.'; return; }
    this.api.startLiveTraffic(d, Number(this.duration)).subscribe({
      next: r => { this.info = 'Live traffic: ' + JSON.stringify(r); this.loadStatus(); },
      error: err => this.error = errorMessage(err)
    });
  }

  stopTraffic(): void {
    this.api.stopLiveTraffic().subscribe({ next: () => { this.info = 'Live traffic stopped.'; this.loadStatus(); }, error: err => this.error = errorMessage(err) });
  }

  addScenario(): void {
    this.error = ''; this.info = '';
    this.api.addScenario(scenarioRequest(this.sc))
      .subscribe({ next: () => { this.info = 'Scenario injected.'; this.loadScenarios(); }, error: err => this.error = errorMessage(err) });
  }

  deleteScenario(id: string): void {
    this.api.deleteScenario(id).subscribe({ next: () => this.loadScenarios(), error: err => this.error = errorMessage(err) });
  }

  clearScenarios(): void {
    this.api.clearScenarios().subscribe({ next: () => this.loadScenarios(), error: err => this.error = errorMessage(err) });
  }

  evaluate(): void {
    this.api.evaluateNow().subscribe({
      next: r => this.info = `Forecast ${r['runId']} done - check Recommendations.`,
      error: err => this.error = errorMessage(err)
    });
  }
}
