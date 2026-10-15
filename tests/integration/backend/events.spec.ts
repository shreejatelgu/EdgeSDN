import type { EventRequest } from '../../../frontend/src/app/core/models';
import { expectStatus } from '../../fixtures/api';
import { uniqueName } from '../../fixtures/env';
import { expect, requireBackend, test } from '../../fixtures/fixtures';

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

function eventRequest(overrides: Partial<EventRequest> = {}): EventRequest {
  return {
    name: uniqueName('Exam'), type: 'EXAM', startTime: inHours(2), durationMinutes: 120, expectedIntensity: 0.8,
    affectedGroups: ['EXAM_HALL'], description: 'created by the integration tests', ...overrides
  };
}

test.describe('Layer 1 - institutional events API', () => {
  test.beforeEach(({ stack }) => requireBackend(stack));
  test.afterEach(async ({ adminApi }) => { await adminApi.cleanupEvents(); });

  test('create -> read -> update -> delete lifecycle', async ({ adminApi }) => {
    const req = eventRequest();
    const created = await adminApi.createEvent(req);
    expect(created).toMatchObject({
      name: req.name, type: 'EXAM', durationMinutes: 120, expectedIntensity: 0.8, affectedGroups: 'EXAM_HALL'
    });
    expect(Date.parse(created.endTime) - Date.parse(created.startTime)).toBe(120 * 60_000);

    const fetched = await adminApi.ok(adminApi.ctx.get(`/api/events/${created.id}`));
    expect(fetched).toMatchObject({ id: created.id, name: req.name });
    expect((await adminApi.events()).some(e => e.id === created.id)).toBe(true);

    const updatedName = req.name + ' (moved)';
    const updated = await adminApi.ok<any>(adminApi.ctx.put(`/api/events/${created.id}`, {
      data: { ...req, name: updatedName, durationMinutes: 60, expectedIntensity: 0.5 }
    }));
    expect(updated).toMatchObject({ id: created.id, name: updatedName, durationMinutes: 60, expectedIntensity: 0.5 });
    expect(Date.parse(updated.endTime) - Date.parse(updated.startTime)).toBe(60 * 60_000);

    await expectStatus(await adminApi.deleteEvent(created.id), 204);
    await expectStatus(await adminApi.ctx.get(`/api/events/${created.id}`), 404);
    await expectStatus(await adminApi.deleteEvent(created.id), 404);
  });

  test('every change is written to the audit log with the acting user', async ({ adminApi }) => {
    const created = await adminApi.createEvent(eventRequest());
    await adminApi.ctx.put(`/api/events/${created.id}`, { data: eventRequest({ name: created.name }) });
    await adminApi.deleteEvent(created.id);
    const recent = (await adminApi.audit({ size: 50 })).content
      .filter(a => (a.summary ?? '').includes(created.name));
    const types = recent.map(a => a.type);
    expect(types).toEqual(expect.arrayContaining(['EVENT_CREATED', 'EVENT_UPDATED', 'EVENT_DELETED']));
    for (const a of recent) { expect(a.actor).toBe('admin'); }
  });

  test('affected groups are normalised to upper case; empty means all client groups', async ({ adminApi, stack }) => {
    const a = await adminApi.createEvent(eventRequest({ affectedGroups: ['lab', ' library ', 'LAB'] }));
    expect(a.affectedGroups).toBe('LAB,LIBRARY');
    const b = await adminApi.createEvent(eventRequest({ affectedGroups: [] }));
    expect(b.affectedGroups).toBe('');
    // Unknown groups are validated against the topology (only possible while it is loaded).
    const unknown = await adminApi.postEvent(eventRequest({ affectedGroups: ['MARS_BASE'] }));
    if (stack.topologyLoaded) {
      expect(unknown.status()).toBe(400);
      expect((await unknown.json()).message).toContain('Unknown client host group: MARS_BASE');
    } else {
      expect(unknown.status()).toBe(201);
    }
  });

  test('the server group cannot be the target of an event (only client groups)', async ({ adminApi, stack }) => {
    test.skip(!stack.topologyLoaded, 'group validation needs the topology from the twin-agent');
    const res = await adminApi.postEvent(eventRequest({ affectedGroups: ['SERVERS'] }));
    expect(res.status()).toBe(400);
  });

  const invalid: [string, Record<string, unknown>, RegExp | null][] = [
    ['blank name', { name: '   ' }, /name/],
    ['name longer than 200 characters', { name: 'x'.repeat(201) }, /name: size must be between 0 and 200/],
    ['missing type', { type: undefined }, /type/],
    ['unknown type', { type: 'PARTY' }, /Malformed request body/],
    ['missing start time', { startTime: undefined }, /startTime/],
    ['duration 0', { durationMinutes: 0 }, /durationMinutes/],
    ['duration above one week', { durationMinutes: 10081 }, /durationMinutes/],
    ['negative intensity', { expectedIntensity: -0.1 }, /expectedIntensity/],
    ['intensity above 1', { expectedIntensity: 1.01 }, /expectedIntensity: must be less than or equal to 1.0/],
    ['missing intensity', { expectedIntensity: undefined }, /expectedIntensity/],
    ['description longer than 1000 characters', { description: 'd'.repeat(1001) }, /description/]
  ];
  for (const [label, patch, message] of invalid) {
    test(`rejects ${label} with 400 and nothing is stored`, async ({ adminApi }) => {
      const body = { ...eventRequest(), ...patch };
      const before = (await adminApi.events()).length;
      const res = await adminApi.postEvent(JSON.parse(JSON.stringify(body)));
      expect(res.status()).toBe(400);
      if (message) { expect((await res.json()).message).toMatch(message); }
      expect((await adminApi.events()).length).toBe(before);
    });
  }

  test('update of a missing event -> 404', async ({ adminApi }) => {
    await expectStatus(await adminApi.ctx.put('/api/events/999999999', { data: eventRequest() }), 404);
  });

  test('CSV import stores valid rows and reports invalid ones with line numbers', async ({ adminApi }) => {
    const n1 = uniqueName('Hackathon, day 1');
    const n2 = uniqueName('Placement');
    const csv = [
      'name,type,startTime,durationMinutes,expectedIntensity,affectedGroups,description',
      `"${n1}",FESTIVAL,${inHours(24)},480,0.6,LAB;LIBRARY,"quoted, with comma"`,
      `${n2},placement,${inHours(48)},240,0.7,,`,
      `${uniqueName('Bad type')},PARTY,${inHours(24)},60,0.5,,`,
      `${uniqueName('Bad date')},EXAM,next monday,60,0.5,,`,
      `${uniqueName('Bad intensity')},EXAM,${inHours(24)},60,2,,`,
      ''
    ].join('\n');
    const res = await adminApi.importCsv(csv);
    expect(res.status()).toBe(200);
    const result = await res.json();
    expect(result.imported).toBe(2);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0]).toMatch(/^line 4: /);
    expect(result.errors[1]).toMatch(/^line 5: /);
    expect(result.errors[2]).toMatch(/^line 6: /);

    const all = await adminApi.events();
    const hack = all.find(e => e.name === n1);
    expect(hack, 'quoted name containing a comma is parsed as one field').toBeTruthy();
    expect(hack).toMatchObject({ type: 'FESTIVAL', affectedGroups: 'LAB,LIBRARY', description: 'quoted, with comma' });
    expect(all.find(e => e.name === n2)).toMatchObject({ type: 'PLACEMENT', affectedGroups: '' });

    const audit = (await adminApi.audit({ type: 'EVENTS_IMPORTED', size: 5 })).content[0];
    expect(audit.summary).toContain('Imported 2 events (3 errors)');
  });

  test('CSV import with Windows line endings works', async ({ adminApi }) => {
    const name = uniqueName('CRLF');
    const csv = `name,type,startTime,durationMinutes,expectedIntensity\r\n${name},OTHER,${inHours(5)},30,0.2\r\n`;
    const result = await adminApi.ok<{ imported: number; errors: string[] }>(adminApi.importCsv(csv));
    expect(result).toEqual({ imported: 1, errors: [] });
  });

  test('CSV import without a body -> 400', async ({ adminApi }) => {
    const res = await adminApi.importCsv('');
    expect(res.status()).toBe(400);
  });

  test('seeded sample events are clearly labelled as synthetic', async ({ adminApi }) => {
    const seeded = (await adminApi.events()).filter(e => e.name === 'Semester Examination (online portal)');
    test.skip(seeded.length === 0, 'sample events only exist on a fresh database');
    for (const e of seeded) { expect(e.description).toContain('Synthetic'); }
  });
});
