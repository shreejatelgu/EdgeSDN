import { uniqueName } from '../../fixtures/env';
import { expect, requireBackend, seedSession, test } from '../../fixtures/fixtures';
import { AuditPage } from '../../fixtures/pages';

test.describe('Audit log page (real UI + backend)', () => {
  test.beforeEach(async ({ page, stack, adminApi }) => {
    requireBackend(stack);
    await seedSession(page, 'admin');
    // guarantee at least one recent entry of a known type
    await adminApi.createEvent({
      name: uniqueName('Audit UI'), type: 'OTHER', startTime: new Date(Date.now() + 3_600_000).toISOString(),
      durationMinutes: 15, expectedIntensity: 0.1, affectedGroups: [], description: null
    });
  });
  test.afterEach(async ({ adminApi }) => { await adminApi.cleanupEvents(); });

  test('the hash chain can be verified from the UI', async ({ page }) => {
    const a = new AuditPage(page);
    await a.goto();
    await a.verifyButton().click();
    await expect(page.locator('.badge', { hasText: 'Audit chain intact' })).toBeVisible();
  });

  test('filtering by type shows only that type (case-insensitive input)', async ({ page }) => {
    const a = new AuditPage(page);
    await a.goto();
    await a.typeFilter().fill('event_created');
    await a.filterButton().click();
    await expect(a.rows().first()).toBeVisible();
    const count = await a.rows().count();
    for (let i = 0; i < count; i++) {
      await expect(a.typeCell(a.rows().nth(i))).toHaveText('EVENT_CREATED');
    }
  });

  test('clicking an entry reveals its details and hash', async ({ page }) => {
    const a = new AuditPage(page);
    await a.goto();
    await a.rows().first().click();
    await expect(a.rows().first()).toContainText(/hash [0-9a-f]{64}/);
  });

  test('filtering by an unknown recommendation shows an empty log', async ({ page }) => {
    const a = new AuditPage(page);
    await a.goto();
    await a.recFilter().fill('999999999');
    await a.filterButton().click();
    await expect(a.rows()).toHaveCount(0);
  });

  test('an invalid type is reported, not silently ignored', async ({ page }) => {
    const a = new AuditPage(page);
    await a.goto();
    await a.typeFilter().fill('NOT_A_TYPE');
    await a.filterButton().click();
    await expect(page.locator('.alert.error')).toBeVisible();
  });
});
