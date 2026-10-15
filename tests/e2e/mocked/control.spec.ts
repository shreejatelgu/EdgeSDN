import { expect, test } from '@playwright/test';
import { MockBackend } from '../../fixtures/mock-backend';
import { AppShell, ControlPage } from '../../fixtures/pages';

const CLASSES = ['EXAM_HALL', 'LAB', 'HOSTEL', 'ADMIN', 'LIBRARY'];

test.describe('Network & demo control (mocked backend)', () => {
  test('exam-surge preset fills the demands and starts real load with exactly those values', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    const c = new ControlPage(page);
    await c.goto();
    await expect(c.demand('EXAM_HALL')).toHaveValue('2');
    await c.button('Exam-surge preset').click();
    const expected: Record<string, number> = { EXAM_HALL: 12, LAB: 6, HOSTEL: 10, ADMIN: 2, LIBRARY: 3 };
    for (const cls of CLASSES) { await expect(c.demand(cls)).toHaveValue(String(expected[cls])); }
    await c.button('Start traffic').click();
    const call = await mock.waitForCall('POST', /\/api\/scenarios\/live-traffic$/);
    expect(call.body).toEqual({ demands: expected, durationSec: 600 });
    await expect(new AppShell(page).infoAlert()).toContainText('Live traffic:');
  });

  test('groups with zero or empty demand are not sent', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    const c = new ControlPage(page);
    await c.goto();
    await c.demand('LAB').fill('0');
    await c.demand('HOSTEL').fill('');
    await c.duration().fill('120');
    await c.button('Start traffic').click();
    const call = await mock.waitForCall('POST', /\/api\/scenarios\/live-traffic$/);
    expect(Object.keys(call.body.demands).sort()).toEqual(['ADMIN', 'EXAM_HALL', 'LIBRARY']);
    expect(call.body.durationSec).toBe(120);
  });

  test('all-zero demand is refused in the browser', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    const c = new ControlPage(page);
    await c.goto();
    for (const cls of CLASSES) { await c.demand(cls).fill('0'); }
    await c.button('Start traffic').click();
    await expect(new AppShell(page).errorAlert()).toHaveText('Enter a demand greater than 0 Mbps for at least one group.');
    expect(mock.callsTo('POST', /live-traffic$/)).toHaveLength(0);
  });

  test('stop traffic calls the backend', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    const c = new ControlPage(page);
    await c.goto();
    await c.button('Stop traffic').click();
    await mock.waitForCall('POST', /\/api\/scenarios\/live-traffic\/stop$/);
    await expect(new AppShell(page).infoAlert()).toHaveText('Live traffic stopped.');
  });

  test('forecast override: defaults to the bottleneck, blank horizon = all horizons, can be removed', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    const c = new ControlPage(page);
    await c.goto();
    await expect(c.link()).toHaveValue('c1-d4');
    await expect(c.horizon()).toHaveValue('');
    await c.button('Inject').click();
    const call = await mock.waitForCall('POST', /^\/api\/scenarios$/);
    expect(call.body).toEqual({
      linkId: 'c1-d4', horizonMinutes: null, predictedUtilization: 0.95, confidence: 0.85, durationMinutes: 30,
      note: 'exam surge demo'
    });
    await expect(new AppShell(page).infoAlert()).toHaveText('Scenario injected.');
    const row = c.scenarioRows().filter({ hasText: 'c1-d4' });
    await expect(row).toContainText('h=all');
    await expect(row).toContainText('95');
    await row.getByRole('button', { name: 'Remove' }).click();
    await mock.waitForCall('DELETE', /^\/api\/scenarios\/sc-1$/);
    await expect(c.scenarioRows()).toHaveCount(0);
  });

  test('forecast override with an explicit horizon and another link', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    const c = new ControlPage(page);
    await c.goto();
    await c.link().selectOption('c1-d1');
    await c.predicted().fill('1.1');
    await c.horizon().fill('15');
    await c.note().fill('lab surge');
    await c.button('Inject').click();
    const call = await mock.waitForCall('POST', /^\/api\/scenarios$/);
    expect(call.body).toMatchObject({ linkId: 'c1-d1', horizonMinutes: 15, predictedUtilization: 1.1, note: 'lab surge' });
  });

  test('re-initialising the baseline routing requires confirmation', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    const c = new ControlPage(page);
    await c.goto();
    page.once('dialog', d => void d.dismiss());
    await c.button('(Re)initialise baseline routing').click();
    await page.waitForTimeout(300);
    expect(mock.callsTo('POST', /\/api\/network\/init$/)).toHaveLength(0);

    page.once('dialog', d => void d.accept());
    await c.button('(Re)initialise baseline routing').click();
    await mock.waitForCall('POST', /\/api\/network\/init$/);
    await expect(new AppShell(page).infoAlert()).toContainText('Baseline routing programmed');
  });

  test('status panel shows controller and agent state', async ({ page }) => {
    await new MockBackend(page).install('admin');
    const c = new ControlPage(page);
    await c.goto();
    const status = page.locator('pre');
    await expect(status).toContainText('OpenDaylight reachable');
    await expect(status).toContainText('"connectedSwitches": 12');
  });

  test('viewer sees the status but none of the demo controls', async ({ page }) => {
    await new MockBackend(page).install('viewer');
    const c = new ControlPage(page);
    await c.goto();
    await expect(page.locator('pre')).toContainText('controller');
    for (const name of ['Start traffic', 'Inject', '(Re)initialise baseline routing', 'Reload topology from agent']) {
      await expect(c.button(name)).toHaveCount(0);
    }
  });
});
