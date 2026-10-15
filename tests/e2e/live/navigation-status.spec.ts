import { expect, requireBackend, requireNoTopology, seedSession, test } from '../../fixtures/fixtures';
import { AppShell, NAV_SECTIONS } from '../../fixtures/pages';

test.describe('Navigation and platform status (real UI + backend)', () => {
  test.beforeEach(async ({ page, stack }) => {
    requireBackend(stack);
    await seedSession(page, 'admin');
  });

  test('every section opens from the navigation without an error', async ({ page }) => {
    await page.goto('/#/');
    const shell = new AppShell(page);
    for (const s of NAV_SECTIONS) {
      await shell.open(s.link);
      await expect(shell.heading(s.heading)).toBeVisible();
      await expect(shell.link(s.link)).toHaveClass(/active/);
      await expect(shell.errorAlert(), `error alert on ${s.link}`).toHaveCount(0);
    }
  });

  test('unknown routes fall back to the dashboard', async ({ page }) => {
    await page.goto('/#/this/does/not/exist');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  });

  test('without the twin-agent the dashboard explains what is missing', async ({ page, stack }) => {
    requireNoTopology(stack);
    await page.goto('/#/');
    await expect(new AppShell(page).warnAlert().filter({ hasText: 'Topology not loaded' })).toContainText('Is the twin-agent running?');
    await expect(page.getByText('Topology not loaded.', { exact: true })).toBeVisible();
  });

  test('without the twin-agent, "Run forecast now" reports the cause', async ({ page, stack }) => {
    requireNoTopology(stack);
    await page.goto('/#/predictions');
    await page.getByRole('button', { name: 'Run forecast now' }).click();
    await expect(new AppShell(page).errorAlert()).toContainText('Topology not loaded');
  });

  test('without the twin-agent, network initialisation reports the cause', async ({ page, stack }) => {
    requireNoTopology(stack);
    await page.goto('/#/control');
    page.once('dialog', d => void d.accept());
    await page.getByRole('button', { name: '(Re)initialise baseline routing', exact: true }).click();
    await expect(new AppShell(page).errorAlert()).toContainText('Topology not loaded');
  });

  test('network status shows controller and agent information', async ({ page }) => {
    await page.goto('/#/control');
    const status = page.locator('pre');
    await expect(status).toContainText('"controller"');
    await expect(status).toContainText('"agent"');
  });

  test('telemetry page states its data source', async ({ page }) => {
    await page.goto('/#/telemetry');
    await expect(page.getByText(/Source (ODL|AGENT)/)).toBeVisible();
  });
});
