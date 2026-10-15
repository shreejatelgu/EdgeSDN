import { DatePipe } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { EventForm, blankEventForm, formFromEvent, toEventRequest } from '../core/event-form';
import { EventType, InstitutionalEvent } from '../core/models';

const SAMPLE_CSV = `name,type,startTime,durationMinutes,expectedIntensity,affectedGroups,description
Mid-semester Exam,EXAM,2026-10-12T04:30:00Z,120,0.8,EXAM_HALL,Synthetic sample
Hackathon,FESTIVAL,2026-10-15T09:00:00Z,480,0.6,LAB;LIBRARY,Synthetic sample`;

@Component({
  selector: 'app-events',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <h1>Institutional events</h1>
    <p class="muted small">Events raise the forecast for the host groups they affect. Leave "affected groups" empty for all client groups.
      Group names: EXAM_HALL, LAB, HOSTEL, ADMIN, LIBRARY.</p>
    @if (error) { <div class="alert error">{{ error }}</div> }
    @if (info) { <div class="alert info">{{ info }}</div> }

    @if (auth.isAdmin()) {
      <div class="panel">
        <h2>{{ form.id ? 'Edit event #' + form.id : 'New event' }}</h2>
        <div class="form-grid">
          <label>Name <input [(ngModel)]="form.name"></label>
          <label>Type
            <select [(ngModel)]="form.type">
              @for (t of types; track t) { <option [value]="t">{{ t }}</option> }
            </select>
          </label>
          <label>Start (local time) <input type="datetime-local" [(ngModel)]="form.start"></label>
          <label>Duration (min) <input type="number" min="1" [(ngModel)]="form.durationMinutes"></label>
          <label>Expected intensity (0-1) <input type="number" min="0" max="1" step="0.05" [(ngModel)]="form.expectedIntensity"></label>
          <label>Affected groups (comma-separated) <input [(ngModel)]="form.groups" placeholder="EXAM_HALL"></label>
        </div>
        <label style="margin-top:12px">Description <input [(ngModel)]="form.description"></label>
        <div class="row" style="margin-top:12px">
          <button class="primary" (click)="save()">{{ form.id ? 'Update' : 'Create' }}</button>
          @if (form.id) { <button (click)="reset()">Cancel</button> }
        </div>
      </div>
    }

    <div class="panel">
      <h2>Events</h2>
      <table>
        <tr><th>Name</th><th>Type</th><th>Start</th><th>End</th><th>Intensity</th><th>Groups</th><th></th></tr>
        @for (e of events; track e.id) {
          <tr>
            <td>{{ e.name }}</td><td>{{ e.type }}</td>
            <td>{{ e.startTime | date:'dd MMM HH:mm' }}</td><td>{{ e.endTime | date:'dd MMM HH:mm' }}</td>
            <td>{{ e.expectedIntensity }}</td><td>{{ e.affectedGroups || 'all' }}</td>
            <td>
              @if (auth.isAdmin()) {
                <button (click)="edit(e)">Edit</button> <button (click)="remove(e)">Delete</button>
              }
            </td>
          </tr>
        }
      </table>
    </div>

    @if (auth.isAdmin()) {
      <div class="panel">
        <h2>Import CSV</h2>
        <p class="muted small">Header: name,type,startTime,durationMinutes,expectedIntensity,affectedGroups,description -
          startTime in ISO-8601 UTC, groups separated by ";".</p>
        <textarea rows="6" class="mono" [(ngModel)]="csv"></textarea>
        <div class="row" style="margin-top:8px"><button (click)="importCsv()">Import</button></div>
      </div>
    }`
})
export class EventsComponent implements OnInit {
  types: EventType[] = ['EXAM', 'PLACEMENT', 'FESTIVAL', 'OTHER'];
  events: InstitutionalEvent[] = [];
  form: EventForm = this.blank();
  csv = SAMPLE_CSV;
  error = '';
  info = '';

  constructor(private api: ApiService, public auth: AuthService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.api.events().subscribe({ next: e => this.events = e, error: err => this.error = errorMessage(err) });
  }

  blank(): EventForm { return blankEventForm(); }

  reset(): void { this.form = this.blank(); }

  edit(e: InstitutionalEvent): void {
    this.form = formFromEvent(e);
  }

  save(): void {
    this.error = ''; this.info = '';
    const result = toEventRequest(this.form);
    if (!result.ok) { this.error = result.error; return; }
    const req = result.request;
    const call = this.form.id ? this.api.updateEvent(this.form.id, req) : this.api.createEvent(req);
    call.subscribe({
      next: () => { this.info = 'Saved.'; this.reset(); this.load(); },
      error: err => this.error = errorMessage(err)
    });
  }

  remove(e: InstitutionalEvent): void {
    if (!confirm(`Delete event "${e.name}"?`)) { return; }
    this.api.deleteEvent(e.id).subscribe({ next: () => this.load(), error: err => this.error = errorMessage(err) });
  }

  importCsv(): void {
    this.error = ''; this.info = '';
    this.api.importEvents(this.csv).subscribe({
      next: r => { this.info = `Imported ${r.imported} events. ${r.errors.join(' | ')}`; this.load(); },
      error: err => this.error = errorMessage(err)
    });
  }
}
