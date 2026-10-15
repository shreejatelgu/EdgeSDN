import { expect, test } from '@playwright/test';
import type { InstitutionalEvent } from '../../frontend/src/app/core/models';
import {
  blankEventForm, formFromEvent, toEventRequest, toLocalInput, type EventForm
} from '../../frontend/src/app/core/event-form';

const validForm = (overrides: Partial<EventForm> = {}): EventForm => ({
  id: null, name: 'Semester Examination', type: 'EXAM', start: '2026-10-05T10:00', durationMinutes: 180,
  expectedIntensity: 0.85, groups: 'EXAM_HALL', description: 'End-semester exam', ...overrides
});

test.describe('toLocalInput', () => {
  test('formats a date for <input type="datetime-local"> with zero padding (local time)', () => {
    expect(toLocalInput(new Date(2026, 0, 5, 7, 3))).toBe('2026-01-05T07:03');
    expect(toLocalInput(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31T23:59');
  });
});

test.describe('blankEventForm', () => {
  test('defaults to an EXAM starting 30 minutes from now, 120 min, intensity 0.8, all groups', () => {
    const now = new Date(2026, 8, 29, 10, 0);
    const f = blankEventForm(now);
    expect(f).toEqual({
      id: null, name: '', type: 'EXAM', start: '2026-09-29T10:30', durationMinutes: 120,
      expectedIntensity: 0.8, groups: '', description: ''
    });
  });
});

test.describe('toEventRequest - valid input', () => {
  test('builds the backend request with an ISO-8601 UTC start time', () => {
    const r = toEventRequest(validForm());
    expect(r.ok).toBe(true);
    if (!r.ok) { return; }
    expect(r.request).toEqual({
      name: 'Semester Examination', type: 'EXAM', startTime: new Date('2026-10-05T10:00').toISOString(),
      durationMinutes: 180, expectedIntensity: 0.85, affectedGroups: ['EXAM_HALL'], description: 'End-semester exam'
    });
    expect(r.request.startTime).toMatch(/Z$/);
  });

  test('normalises groups: trims, upper-cases, drops blanks and duplicates', () => {
    const r = toEventRequest(validForm({ groups: ' lab , Library,,LAB , ' }));
    expect(r.ok && r.request.affectedGroups).toEqual(['LAB', 'LIBRARY']);
  });

  test('empty groups means "all client groups" (empty list)', () => {
    const r = toEventRequest(validForm({ groups: '' }));
    expect(r.ok && r.request.affectedGroups).toEqual([]);
  });

  test('coerces numeric strings coming from number inputs', () => {
    const r = toEventRequest(validForm({ durationMinutes: '90', expectedIntensity: '0.5' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.durationMinutes).toBe(90);
      expect(r.request.expectedIntensity).toBe(0.5);
    }
  });

  test('trims the name and turns a blank description into null', () => {
    const r = toEventRequest(validForm({ name: '  Placement Drive  ', description: '   ' }));
    expect(r.ok && r.request.name).toBe('Placement Drive');
    expect(r.ok && r.request.description).toBeNull();
  });

  test('accepts the boundary values 0 and 1 for intensity, 1 and 10080 for duration', () => {
    for (const [d, i] of [[1, 0], [10080, 1]] as const) {
      expect(toEventRequest(validForm({ durationMinutes: d, expectedIntensity: i })).ok).toBe(true);
    }
  });
});

test.describe('toEventRequest - rejected input (never sent to the backend)', () => {
  const cases: [string, Partial<EventForm>, RegExp][] = [
    ['blank name', { name: '   ' }, /Name is required/],
    ['missing start', { start: '' }, /Invalid start time/],
    ['unparsable start', { start: 'tomorrow morning' }, /Invalid start time/],
    ['zero duration', { durationMinutes: 0 }, /Duration/],
    ['fractional duration', { durationMinutes: 1.5 }, /Duration/],
    ['too long duration', { durationMinutes: 10081 }, /Duration/],
    ['text duration', { durationMinutes: 'abc' }, /Duration/],
    ['negative intensity', { expectedIntensity: -0.1 }, /intensity/],
    ['intensity above 1', { expectedIntensity: 1.5 }, /intensity/],
    ['empty intensity', { expectedIntensity: '' }, /intensity/]
  ];
  for (const [label, patch, message] of cases) {
    test(label, () => {
      const r = toEventRequest(validForm(patch));
      expect(r.ok).toBe(false);
      if (!r.ok) { expect(r.error).toMatch(message); }
    });
  }
});

test.describe('formFromEvent', () => {
  test('round-trips an existing event through the edit form unchanged', () => {
    const e: InstitutionalEvent = {
      id: 7, name: 'Cultural Festival Live Stream', type: 'FESTIVAL', startTime: '2026-10-02T12:30:00.000Z',
      endTime: '2026-10-02T17:30:00.000Z', durationMinutes: 300, expectedIntensity: 0.9,
      affectedGroups: 'HOSTEL,LIBRARY', description: 'Synthetic sample event'
    };
    const form = formFromEvent(e);
    expect(form.id).toBe(7);
    const r = toEventRequest(form);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request).toEqual({
        name: e.name, type: 'FESTIVAL', startTime: e.startTime, durationMinutes: 300, expectedIntensity: 0.9,
        affectedGroups: ['HOSTEL', 'LIBRARY'], description: 'Synthetic sample event'
      });
    }
  });

  test('null description and groups become empty strings in the form', () => {
    const f = formFromEvent({
      id: 1, name: 'x', type: 'OTHER', startTime: '2026-10-02T12:30:00Z', endTime: '2026-10-02T13:30:00Z',
      durationMinutes: 60, expectedIntensity: 0.1, affectedGroups: null as unknown as string, description: null
    });
    expect(f.groups).toBe('');
    expect(f.description).toBe('');
  });
});
