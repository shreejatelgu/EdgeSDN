import { expect, test, type Page } from '@playwright/test';
import { MockBackend } from '../../fixtures/mock-backend';
import { AppShell } from '../../fixtures/pages';

const topologySvg = (page: Page) => page.getByRole('img', { name: 'Campus SDN topology' });
/** The drawn line of a link (identified by its tooltip), not the highlight halo behind it. */
const edge = (page: Page, id: string) =>
  topologySvg(page).locator('line').filter({ has: page.locator('title', { hasText: new RegExp(`^${id}\\s`) }) });

test.describe('Dashboard (mocked backend)', () => {
  test('draws the campus topology: 12 switches and 15 links', async ({ page }) => {
    await new MockBackend(page).install('admin');
    await page.goto('/#/');
    await expect(topologySvg(page)).toBeVisible();
    await expect(topologySvg(page).locator('g')).toHaveCount(12);
    await expect(topologySvg(page).locator('line:has(title)')).toHaveCount(15);
    for (const label of ['Examination Hall', 'Computer Labs', 'Hostel Wi-Fi', 'Server Farm']) {
      await expect(topologySvg(page)).toContainText(label);
    }
  });

  test('link colour follows live utilisation; predicted congestion is dashed', async ({ page }) => {
    await new MockBackend(page).install('admin');
    await page.goto('/#/');
    await expect(edge(page, 'c1-d4')).toHaveAttribute('stroke', '#c0392b');   // 93 %
    await expect(edge(page, 'c1-d4')).toHaveAttribute('stroke-dasharray', '8 5'); // predicted 97 %
    await expect(edge(page, 'c1-d1')).toHaveAttribute('stroke', '#d4a017');   // 62 %
    expect(await edge(page, 'c1-d1').getAttribute('stroke-dasharray')).toBeNull(); // predicted 71 %
    await expect(edge(page, 'a1-d1')).toHaveAttribute('stroke', '#2ea043');   // 12 %
    await expect(edge(page, 'c2-d3')).toHaveAttribute('stroke', '#b8c2cc');   // no telemetry
  });

  test('the link of the first open recommendation is highlighted', async ({ page }) => {
    await new MockBackend(page).install('admin');
    await page.goto('/#/');
    await expect(topologySvg(page).locator('line[stroke="#ffd33d"]')).toHaveCount(1);
  });

  test('KPI tiles summarise open decisions, active actions and the approval mode', async ({ page }) => {
    await new MockBackend(page).install('admin');
    await page.goto('/#/');
    await expect(page.locator('.kpi', { hasText: 'open recommendations' }).locator('.value')).toHaveText('2');
    await expect(page.locator('.kpi', { hasText: 'active actions' }).locator('.value')).toHaveText('2');
    await expect(page.locator('.kpi', { hasText: 'approval mode' }).locator('.value')).toHaveText('MANUAL');
  });

  test('links table shows current load and the predicted peak with its horizon', async ({ page }) => {
    await new MockBackend(page).install('admin');
    await page.goto('/#/');
    const row = page.locator('table tr:has(td)').filter({ hasText: /^\s*c1-d4\s/ });
    await expect(row).toContainText('93%');
    await expect(row).toContainText('97% (30 min)');
  });

  test('an open recommendation links to its review page', async ({ page }) => {
    await new MockBackend(page).install('admin');
    await page.goto('/#/');
    await page.getByRole('link', { name: '#42' }).click();
    await expect(page).toHaveURL(/#\/recommendations\/42$/);
    await expect(page.getByRole('heading', { level: 1, name: /Recommendation #42/ })).toBeVisible();
  });

  test('warns when the twin-agent topology is missing and telemetry is stale', async ({ page }) => {
    await new MockBackend(page, s => {
      s.topologyLoaded = false;
      s.topologyError = 'Twin agent unreachable (fetch topology)';
      s.telemetryStale = true;
    }).install('admin');
    await page.goto('/#/');
    const shell = new AppShell(page);
    await expect(shell.warnAlert().filter({ hasText: 'Topology not loaded' })).toContainText('Twin agent unreachable');
    await expect(shell.warnAlert().filter({ hasText: 'Telemetry is stale' })).toBeVisible();
    await expect(page.getByText('Topology not loaded.', { exact: true })).toBeVisible();
    await expect(shell.errorAlert()).toHaveCount(0);
  });

  test('dashboard refreshes by itself every few seconds', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    await page.goto('/#/');
    await expect(topologySvg(page)).toBeVisible();
    const first = mock.callsTo('GET', /^\/api\/dashboard$/).length;
    await expect.poll(() => mock.callsTo('GET', /^\/api\/dashboard$/).length, { timeout: 12_000 }).toBeGreaterThan(first);
  });
});
