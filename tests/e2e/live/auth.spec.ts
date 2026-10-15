import { ENV } from '../../fixtures/env';
import { expect, loginViaUi, requireBackend, test } from '../../fixtures/fixtures';
import { AppShell, LoginPage, NAV_SECTIONS } from '../../fixtures/pages';

test.describe('Login, session and role-based UI (real backend)', () => {
  test.beforeEach(({ stack }) => requireBackend(stack));

  test('deep links require login', async ({ page }) => {
    await page.goto('/#/policy');
    await expect(page).toHaveURL(/#\/login$/);
    await expect(new LoginPage(page).title()).toBeVisible();
  });

  test('wrong credentials are rejected and the user stays on the login page', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(ENV.admin.username, 'not-the-password');
    await expect(login.error()).toHaveText('Invalid username or password');
    await expect(page).toHaveURL(/#\/login$/);
  });

  test('administrator logs in and sees every section', async ({ page }) => {
    await loginViaUi(page, 'admin');
    const shell = new AppShell(page);
    await expect(shell.userLabel()).toContainText(`${ENV.admin.username} (admin)`);
    for (const s of NAV_SECTIONS) { await expect(shell.link(s.link)).toBeVisible(); }
  });

  test('the session survives a page reload', async ({ page }) => {
    await loginViaUi(page, 'admin');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(new AppShell(page).userLabel()).toContainText('(admin)');
  });

  test('logout ends the session and protects the routes again', async ({ page }) => {
    await loginViaUi(page, 'admin');
    await new AppShell(page).logout();
    await expect(page).toHaveURL(/#\/login$/);
    await page.goto('/#/recommendations');
    await expect(page).toHaveURL(/#\/login$/);
    expect(await page.evaluate(() => sessionStorage.getItem('edge-sdn-auth'))).toBeNull();
  });

  test('credentials that stop working (401) send the user back to login', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('edge-sdn-auth', JSON.stringify({
      token: 'Basic ' + btoa('admin:outdated-password'), me: { username: 'admin', roles: ['ROLE_ADMIN'] }
    })));
    await page.goto('/#/');
    await expect(page).toHaveURL(/#\/login$/, { timeout: 15_000 });
  });

  test('viewer: read-only everywhere', async ({ page }) => {
    await loginViaUi(page, 'viewer');
    const shell = new AppShell(page);
    await expect(shell.userLabel()).toContainText(`${ENV.viewer.username} (viewer)`);

    await shell.open('Institutional events');
    await expect(page.getByRole('heading', { name: 'Institutional events', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'New event' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Import CSV' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);

    await shell.open('Policy');
    await expect(page.getByLabel('w1 improvement', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save policy' })).toHaveCount(0);

    await shell.open('Recommendations');
    await expect(page.getByRole('button', { name: 'Evaluate network now' })).toHaveCount(0);

    await shell.open('Network & demo');
    await expect(page.getByRole('button', { name: 'Start traffic' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '(Re)initialise baseline routing' })).toHaveCount(0);
  });
});
