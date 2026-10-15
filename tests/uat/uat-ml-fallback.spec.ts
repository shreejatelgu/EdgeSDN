import { expectStatus } from '../fixtures/api';
import { expect, loginViaUi, requireBackend, test } from '../fixtures/fixtures';

/**
 * User acceptance - ML integration safety. Needs the backend with a loaded topology (twin-agent running);
 * OpenDaylight is not required. The expected outcome depends on whether the ML service is running.
 */
test('UAT-10 The forecast always states its model, and an ML outage falls back to rule-based forecasting', {
  tag: ['@uat'],
  annotation: { type: 'requirement', description: 'ML integration endpoints with safe fallback; no silent model substitution' }
}, async ({ page, adminApi, stack }) => {
  requireBackend(stack);
  test.skip(!stack.topologyLoaded, 'forecasting needs the topology from the twin-agent');
  await adminApi.clearScenarios();

  await test.step('Given the ML provider is selected', async () => {
    await expectStatus(await adminApi.setProvider('ML'), 200);
  });
  try {
    await test.step('When a forecast is run from the Predictions page', async () => {
      await loginViaUi(page, 'admin');
      await page.goto('/#/predictions');
      await page.getByRole('button', { name: 'Run forecast now' }).click();
      await expect(page.getByRole('heading', { level: 2, name: /Latest run/ })).toBeVisible();
    });
    await test.step('Then the page states which model produced the forecast', async () => {
      const heading = page.getByRole('heading', { level: 2, name: /Latest run/ });
      if (stack.mlReachable) {
        await expect(heading).toContainText('ML');
        await expect(heading).not.toContainText('fallback');
        await expect(page.locator('.alert.warn', { hasText: 'Fallback used' })).toHaveCount(0);
      } else {
        await expect(heading).toContainText('RULE_BASED (fallback from ML)');
        await expect(page.locator('.alert.warn', { hasText: 'Fallback used' })).toBeVisible();
      }
    });
    await test.step('And a fallback (if any) is recorded in the audit log', async () => {
      if (stack.mlReachable) {
        test.info().annotations.push({ type: 'note', description: 'ML service running: no fallback expected' });
        return;
      }
      const entry = (await adminApi.audit({ type: 'PREDICTION_FALLBACK', size: 1 })).content[0];
      expect(entry.summary).toContain('RULE_BASED fallback used');
    });
  } finally {
    await adminApi.setProvider('RULE_BASED');
  }
});
