import type { PolicyConfig } from '../../../frontend/src/app/core/models';
import { EdgeApi, apiContext, expectStatus } from '../../fixtures/api';
import { expect, requireBackend, seedSession, test } from '../../fixtures/fixtures';
import { AppShell, PolicyPage } from '../../fixtures/pages';

// Policy is global state: serial, and the original policy is restored afterwards.
test.describe.configure({ mode: 'serial' });

test.describe('Policy page - controlled automation settings (real UI + backend)', () => {
  let original: PolicyConfig;

  test.beforeAll(async () => {
    const ctx = await apiContext('admin');
    original = await new EdgeApi(ctx).policy();
    await ctx.dispose();
  });

  test.afterAll(async () => {
    const ctx = await apiContext('admin');
    await expectStatus(await new EdgeApi(ctx).putPolicy(original), 200);
    await ctx.dispose();
  });

  test.beforeEach(async ({ page, stack }) => {
    requireBackend(stack);
    await seedSession(page, 'admin');
  });

  test('shows the transparent score formula and the current values', async ({ page, adminApi }) => {
    const p = new PolicyPage(page);
    await p.goto();
    await expect(page.getByRole('heading', { level: 2, name: /Score = w1·KPIImprovement \+ w2·Confidence − w3·Risk/ })).toBeVisible();
    const current = await adminApi.policy();
    await expect(p.field('w1 improvement')).toHaveValue(String(current.weightImprovement));
    await expect(p.field('w3 risk')).toHaveValue(String(current.weightRisk));
    await expect(p.approvalMode()).toHaveValue(current.approvalMode);
  });

  test('saving a change persists it and records it in the audit log', async ({ page, adminApi }) => {
    const p = new PolicyPage(page);
    await p.goto();
    await p.approvalMode().selectOption('AUTO_LOW_RISK');
    await p.field('w1 improvement').fill('0.6');
    await p.field('Auto: allowed actions (CSV)').fill('reroute, rate_limit');
    await p.save().click();
    await expect(new AppShell(page).infoAlert()).toHaveText('Policy saved (recorded in the audit log).');

    await page.reload();
    await expect(p.approvalMode()).toHaveValue('AUTO_LOW_RISK');
    await expect(p.field('w1 improvement')).toHaveValue('0.6');
    await expect(p.field('Auto: allowed actions (CSV)')).toHaveValue('REROUTE,RATE_LIMIT');
    await expect(page.getByText(/Last updated .* by admin/)).toBeVisible();

    const saved = await adminApi.policy();
    expect(saved).toMatchObject({ approvalMode: 'AUTO_LOW_RISK', weightImprovement: 0.6, autoAllowedActions: 'REROUTE,RATE_LIMIT' });
    const audit = (await adminApi.audit({ type: 'POLICY_UPDATED', size: 1 })).content[0];
    expect(audit.actor).toBe('admin');
  });

  test('all-zero weights are refused with the backend message', async ({ page }) => {
    const p = new PolicyPage(page);
    await p.goto();
    for (const f of ['w1 improvement', 'w2 confidence', 'w3 risk']) { await p.field(f).fill('0'); }
    await p.save().click();
    await expect(new AppShell(page).errorAlert()).toHaveText('At least one score weight must be > 0');
  });

  test('an emptied field is reported instead of silently saved as 0', async ({ page, adminApi }) => {
    const before = await adminApi.policy();
    const p = new PolicyPage(page);
    await p.goto();
    await p.field('w3 risk').fill('');
    await p.save().click();
    await expect(new AppShell(page).errorAlert()).toContainText('weightRisk: must not be null');
    expect((await adminApi.policy()).weightRisk).toBe(before.weightRisk);
  });

  test('out-of-range values are refused', async ({ page }) => {
    const p = new PolicyPage(page);
    await p.goto();
    await p.field('Max candidates (1-5)').fill('9');
    await p.save().click();
    await expect(new AppShell(page).errorAlert()).toContainText('maxCandidates');
  });
});
