import { expect, test } from '@playwright/test';
import { MockBackend } from '../../fixtures/mock-backend';
import { AppShell } from '../../fixtures/pages';

test.describe('Predictions page (mocked backend)', () => {
  const rows = (page: import('@playwright/test').Page) => page.locator('table tr:has(td)');

  test('lists one forecast per link and horizon; congested values are red', async ({ page }) => {
    await new MockBackend(page).install('admin');
    await page.goto('/#/predictions');
    await expect(rows(page)).toHaveCount(6);
    const congested = rows(page).filter({ hasText: 'c1-d4' }).filter({ hasText: '30 min' });
    await expect(congested.locator('td').nth(2)).toHaveText('97%');
    await expect(congested.locator('td').nth(2)).toHaveCSS('color', 'rgb(192, 57, 43)');
    const normal = rows(page).filter({ hasText: 'c1-d1' }).filter({ hasText: '30 min' });
    await expect(normal.locator('td').nth(2)).not.toHaveCSS('color', 'rgb(192, 57, 43)');
  });

  test('selecting a forecast shows its factual explanation and counterfactuals', async ({ page }) => {
    await new MockBackend(page).install('admin');
    await page.goto('/#/predictions');
    await rows(page).filter({ hasText: 'c1-d4' }).filter({ hasText: '30 min' }).click();
    await expect(page.getByRole('heading', { name: 'Explanation - c1-d4 in 30 min' })).toBeVisible();
    const factor = page.getByRole('row').filter({ hasText: 'event:Semester Examination' });
    await expect(factor).toContainText('+31 pp');
    await expect(page.getByRole('row').filter({ hasText: 'recentBaseline' })).toContainText('+62 pp');
    await expect(page.getByText("Without event 'Semester Examination' the prediction would be 66%")).toBeVisible();
  });

  test('an ML outage is visible: fallback warning and provider in the heading', async ({ page }) => {
    await new MockBackend(page, s => {
      s.forecast!.fallbackUsed = true;
      s.forecast!.provider = 'RULE_BASED (fallback from ML)';
      s.forecast!.fallbackReason = 'ML service unreachable (predict): Connection refused';
    }).install('admin');
    await page.goto('/#/predictions');
    await expect(new AppShell(page).warnAlert()).toHaveText('Fallback used: ML service unreachable (predict): Connection refused');
    await expect(page.getByRole('heading', { level: 2, name: /Latest run/ })).toContainText('RULE_BASED (fallback from ML)');
  });

  test('ML service status and provider switching', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    await page.goto('/#/predictions');
    await expect(page.getByText('unreachable', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Use ML service' }).click();
    const call = await mock.waitForCall('PUT', /\/api\/ml\/provider$/);
    expect(call.body).toEqual({ provider: 'ML' });
    await expect(page.getByText(/Active:\s*ML/)).toBeVisible();
    await page.getByRole('button', { name: 'Use RULE_BASED' }).click();
    await expect(page.getByText(/Active:\s*RULE_BASED/)).toBeVisible();
  });

  test('before the first forecast an explanatory message is shown', async ({ page }) => {
    await new MockBackend(page, s => { s.forecast = null; }).install('admin');
    await page.goto('/#/predictions');
    await expect(page.getByText(/No forecast yet/)).toBeVisible();
  });

  test('"Run forecast now" calls the backend and shows the run', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    await page.goto('/#/predictions');
    await page.getByRole('button', { name: 'Run forecast now' }).click();
    await mock.waitForCall('POST', /\/api\/predictions\/run$/);
    await expect(rows(page)).toHaveCount(6);
  });

  test('viewer cannot switch provider or run forecasts', async ({ page }) => {
    await new MockBackend(page).install('viewer');
    await page.goto('/#/predictions');
    await expect(rows(page)).toHaveCount(6);
    for (const name of ['Use RULE_BASED', 'Use ML service', 'Run forecast now']) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
  });
});

test.describe('Telemetry page (mocked backend)', () => {
  test('clicking a link shows its utilisation history as a chart', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    await page.goto('/#/telemetry');
    await page.locator('table tr:has(td)').filter({ hasText: /^\s*c1-d4\s/ }).click();
    await expect(page.getByRole('heading', { name: 'History - c1-d4 (last 30 min)' })).toBeVisible();
    const call = await mock.waitForCall('GET', /\/api\/telemetry\/history$/);
    expect(call.query.get('subjectId')).toBe('c1-d4');
    const chart = page.getByRole('img', { name: '10 samples' });
    await expect(chart).toBeVisible();
    const points = await chart.locator('polyline').getAttribute('points');
    expect(points?.split(' ')).toHaveLength(10);
  });

  test('stale telemetry is flagged', async ({ page }) => {
    await new MockBackend(page, s => { s.telemetryStale = true; }).install('admin');
    await page.goto('/#/telemetry');
    await expect(page.locator('.badge', { hasText: 'stale' })).toBeVisible();
  });

  test('host-group demand is listed', async ({ page }) => {
    await new MockBackend(page).install('admin');
    await page.goto('/#/telemetry');
    await expect(page.locator('table tr:has(td)').filter({ hasText: 'EXAM_HALL' })).toContainText('10.10');
  });
});
