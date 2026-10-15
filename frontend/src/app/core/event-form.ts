// Framework-free conversion between the event form and the backend EventRequest (unit-tested).
import type { EventRequest, EventType, InstitutionalEvent } from './models';

export interface EventForm {
  id: number | null;
  name: string;
  type: EventType;
  /** Value of <input type="datetime-local">: local time "YYYY-MM-DDTHH:mm". */
  start: string;
  durationMinutes: number | string;
  expectedIntensity: number | string;
  /** Comma-separated host-group names; empty = all client groups. */
  groups: string;
  description: string;
}

export type EventRequestResult = { ok: true; request: EventRequest } | { ok: false; error: string };

export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** New-event defaults: starts 30 minutes from `now`. */
export function blankEventForm(now: Date = new Date()): EventForm {
  return {
    id: null, name: '', type: 'EXAM', start: toLocalInput(new Date(now.getTime() + 30 * 60_000)),
    durationMinutes: 120, expectedIntensity: 0.8, groups: '', description: ''
  };
}

export function formFromEvent(e: InstitutionalEvent): EventForm {
  return {
    id: e.id, name: e.name, type: e.type, start: toLocalInput(new Date(e.startTime)),
    durationMinutes: e.durationMinutes, expectedIntensity: e.expectedIntensity,
    groups: e.affectedGroups ?? '', description: e.description ?? ''
  };
}

/** Validates the form and builds the request. Mirrors the backend limits so obvious errors never leave the browser. */
export function toEventRequest(form: EventForm): EventRequestResult {
  const name = (form.name ?? '').trim();
  if (!name) { return { ok: false, error: 'Name is required' }; }
  const start = new Date(form.start);
  if (!form.start || Number.isNaN(start.getTime())) { return { ok: false, error: 'Invalid start time' }; }
  const duration = Number(form.durationMinutes);
  if (!Number.isInteger(duration) || duration < 1 || duration > 10080) {
    return { ok: false, error: 'Duration must be a whole number of minutes between 1 and 10080' };
  }
  const intensity = form.expectedIntensity === '' ? NaN : Number(form.expectedIntensity);
  if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
    return { ok: false, error: 'Expected intensity must be between 0 and 1' };
  }
  const groups = Array.from(new Set((form.groups ?? '').split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => s.length > 0)));
  const description = (form.description ?? '').trim();
  return {
    ok: true,
    request: {
      name, type: form.type, startTime: start.toISOString(), durationMinutes: duration,
      expectedIntensity: intensity, affectedGroups: groups, description: description.length > 0 ? description : null
    }
  };
}
