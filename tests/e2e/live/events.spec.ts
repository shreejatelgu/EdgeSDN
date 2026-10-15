import { toLocalInput } from '../../../frontend/src/app/core/event-form';
import { uniqueName } from '../../fixtures/env';
import { expect, requireBackend, seedSession, test } from '../../fixtures/fixtures';
import { AppShell, EventsPage } from '../../fixtures/pages';

const inHoursLocal = (h: number) => toLocalInput(new Date(Date.now() + h * 3_600_000));
const inHoursIso = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

test.describe('Institutional events - administrator workflow (real UI + backend)', () => {
  test.beforeEach(async ({ page, stack }) => {
    requireBackend(stack);
    await seedSession(page, 'admin');
  });
  test.afterEach(async ({ adminApi }) => { await adminApi.cleanupEvents(); });

  test('create, edit and delete an event through the form', async ({ page, adminApi }) => {
    const events = new EventsPage(page);
    const shell = new AppShell(page);
    const name = uniqueName('Semester exam');
    await events.goto();
    await events.fill({ name, type: 'EXAM', start: inHoursLocal(2), duration: '90', intensity: '0.75', groups: 'exam_hall' });
    await events.submit().click();
    await expect(shell.infoAlert()).toHaveText('Saved.');
    const row = events.row(name);
    await expect(row).toContainText('EXAM');
    await expect(row).toContainText('0.75');
    await expect(row).toContainText('EXAM_HALL');

    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: /^Edit event #\d+$/ })).toBeVisible();
    await expect(events.name()).toHaveValue(name);
    await events.fill({ name: name + ' moved', intensity: '0.6' });
    await events.submit().click();
    await expect(shell.infoAlert()).toHaveText('Saved.');
    await expect(events.row(name + ' moved')).toContainText('0.6');
    await expect(page.getByRole('heading', { name: 'New event' })).toBeVisible();

    page.once('dialog', d => { expect(d.message()).toContain(name + ' moved'); void d.accept(); });
    await events.row(name + ' moved').getByRole('button', { name: 'Delete' }).click();
    await expect(events.row(name + ' moved')).toHaveCount(0);
    expect((await adminApi.events()).some(e => e.name.startsWith(name))).toBe(false);
  });

  test('cancelling the delete confirmation keeps the event', async ({ page, adminApi }) => {
    const name = uniqueName('Keep me');
    await adminApi.createEvent({ name, type: 'OTHER', startTime: inHoursIso(3), durationMinutes: 30, expectedIntensity: 0.2, affectedGroups: [], description: null });
    const events = new EventsPage(page);
    await events.goto();
    page.once('dialog', d => void d.dismiss());
    await events.row(name).getByRole('button', { name: 'Delete' }).click();
    await page.waitForTimeout(500);
    await expect(events.row(name)).toHaveCount(1);
  });

  test('obviously invalid input is caught in the browser and never sent', async ({ page }) => {
    const events = new EventsPage(page);
    await events.goto();
    const posts: string[] = [];
    page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/events')) { posts.push(r.url()); } });
    await events.fill({ name: uniqueName('Too intense'), intensity: '1.5' });
    await events.submit().click();
    await expect(new AppShell(page).errorAlert()).toHaveText('Expected intensity must be between 0 and 1');
    await events.fill({ intensity: '0.5', name: '   ' });
    await events.submit().click();
    await expect(new AppShell(page).errorAlert()).toHaveText('Name is required');
    expect(posts).toHaveLength(0);
  });

  test('server-side validation errors are shown to the administrator', async ({ page }) => {
    const events = new EventsPage(page);
    await events.goto();
    await events.fill({ name: 'PW-TEST ' + 'x'.repeat(200) });
    await events.submit().click();
    await expect(new AppShell(page).errorAlert()).toContainText('size must be between 0 and 200');
  });

  test('CSV import reports imported rows and line-numbered errors', async ({ page, adminApi }) => {
    const n1 = uniqueName('CSV exam');
    const n2 = uniqueName('CSV fest');
    const events = new EventsPage(page);
    await events.goto();
    await events.csv().fill([
      'name,type,startTime,durationMinutes,expectedIntensity,affectedGroups,description',
      `${n1},EXAM,${inHoursIso(24)},120,0.8,EXAM_HALL,Synthetic`,
      `${n2},FESTIVAL,${inHoursIso(48)},300,0.9,HOSTEL;LIBRARY,Synthetic`,
      `${uniqueName('CSV bad')},PARTY,${inHoursIso(24)},60,0.5,,`
    ].join('\n'));
    await events.importButton().click();
    const info = new AppShell(page).infoAlert();
    await expect(info).toContainText('Imported 2 events.');
    await expect(info).toContainText('line 4:');
    await expect(events.row(n1)).toBeVisible();
    await expect(events.row(n2)).toContainText('HOSTEL,LIBRARY');
    const stored = (await adminApi.events()).filter(e => e.name === n1 || e.name === n2);
    expect(stored).toHaveLength(2);
  });
});
