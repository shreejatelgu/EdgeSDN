import { expect, test } from '@playwright/test';
import { MockBackend } from '../../fixtures/mock-backend';
import { AppShell, EnforcementsPage } from '../../fixtures/pages';

test.describe('Enforcements - monitoring, revert and rollback demo (mocked backend)', () => {
  test('action buttons depend on the enforcement state', async ({ page }) => {
    await new MockBackend(page).install('admin');
    const p = new EnforcementsPage(page);
    await p.goto();
    // 7 MONITORING, 6 VERIFIED, 5 ROLLED_BACK, 4 REVERTED
    await expect(p.revert(7)).toBeVisible();
    await expect(p.inject(7)).toBeVisible();
    await expect(p.revert(6)).toBeVisible();
    await expect(p.inject(6)).toHaveCount(0);
    for (const id of [5, 4]) {
      await expect(p.row(id).getByRole('button')).toHaveCount(0);
    }
  });

  test('shows baseline vs last KPIs and the rollback reason', async ({ page }) => {
    await new MockBackend(page).install('admin');
    const p = new EnforcementsPage(page);
    await p.goto();
    await expect(p.row(7)).toContainText('max 95% / 40.1 ms');
    await expect(p.row(7)).toContainText('→ max 70% / 14.2 ms');
    await expect(p.row(5)).toContainText('Automatic rollback: busiest-link utilisation rose 70% -> 96%');
    await expect(p.row(5)).toContainText('ROLLED_BACK');
  });

  test('injecting a regression (demo) needs confirmation', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    const p = new EnforcementsPage(page);
    await p.goto();

    page.once('dialog', d => d.dismiss());
    await p.inject(7).click();
    await page.waitForTimeout(300);
    expect(mock.callsTo('POST', /inject-regression$/)).toHaveLength(0);

    page.once('dialog', d => { expect(d.type()).toBe('confirm'); void d.accept(); });
    await p.inject(7).click();
    await mock.waitForCall('POST', /\/api\/enforcements\/7\/inject-regression$/);
    await expect(new AppShell(page).infoAlert()).toContainText('Synthetic regression injected');
    // next poll: the row is labelled and the button disappears
    await expect(p.row(7).getByText('demo regression')).toBeVisible({ timeout: 10_000 });
    await expect(p.inject(7)).toHaveCount(0);
  });

  test('manual revert asks for a reason and sends it', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    const p = new EnforcementsPage(page);
    await p.goto();
    page.once('dialog', d => { expect(d.type()).toBe('prompt'); void d.accept('peak is over'); });
    await p.revert(7).click();
    const call = await mock.waitForCall('POST', /\/api\/enforcements\/7\/revert$/);
    expect(call.body).toEqual({ reason: 'peak is over' });
    await expect(new AppShell(page).infoAlert()).toHaveText('Enforcement #7 reverted.');
    await expect(p.row(7)).toContainText('REVERTED', { timeout: 10_000 });
    await expect(p.row(7).getByRole('button')).toHaveCount(0);
  });

  test('viewer can inspect enforcements but not change them', async ({ page }) => {
    await new MockBackend(page).install('viewer');
    const p = new EnforcementsPage(page);
    await p.goto();
    await expect(p.row(7)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Revert' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Inject regression (demo)' })).toHaveCount(0);
  });

  test('backend errors on revert are displayed', async ({ page }) => {
    await new MockBackend(page).on('POST', /\/revert$/, () => ({
      status: 409, json: { status: 409, message: 'Enforcement 7 is ROLLED_BACK and has no active rules' }
    })).install('admin');
    const p = new EnforcementsPage(page);
    await p.goto();
    page.once('dialog', d => void d.accept(''));
    await p.revert(7).click();
    await expect(new AppShell(page).errorAlert()).toHaveText('Enforcement 7 is ROLLED_BACK and has no active rules');
  });
});
