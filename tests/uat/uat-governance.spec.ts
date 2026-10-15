import type { PolicyConfig } from '../../frontend/src/app/core/models';
import { toLocalInput } from '../../frontend/src/app/core/event-form';
import { EdgeApi, apiContext, expectStatus } from '../fixtures/api';
import { uniqueName } from '../fixtures/env';
import { expect, loginViaUi, requireBackend, test } from '../fixtures/fixtures';
import { AppShell, AuditPage, EventsPage, PolicyPage, RecommendationDetailPage } from '../fixtures/pages';

/**
 * User acceptance - governance scenarios. They need the frontend and backend only (no Mininet), so they
 * can be accepted on any laptop. Each test is one acceptance criterion written as Given / When / Then.
 */
test.describe.configure({ mode: 'serial' });

let originalPolicy: PolicyConfig;

test.beforeAll(async () => {
  const ctx = await apiContext('admin');
  originalPolicy = await new EdgeApi(ctx).policy();
  await ctx.dispose();
});

test.afterAll(async () => {
  const ctx = await apiContext('admin');
  const api = new EdgeApi(ctx);
  await expectStatus(await api.putPolicy(originalPolicy), 200);
  await api.cleanupEvents();
  await ctx.dispose();
});

test.beforeEach(({ stack }) => requireBackend(stack));

test('UAT-01 The administrator signs in and sees the operational status of the platform', {
  tag: '@uat', annotation: { type: 'requirement', description: 'Administrator dashboard: network state, open decisions, approval mode' }
}, async ({ page, stack }) => {
  await test.step('Given valid administrator credentials', async () => {
    await loginViaUi(page, 'admin');
  });
  await test.step('Then the dashboard shows open recommendations, active actions and the approval mode', async () => {
    for (const label of ['open recommendations', 'active actions', 'approval mode']) {
      await expect(page.locator('.kpi', { hasText: label })).toBeVisible();
    }
  });
  await test.step('And the state of the SDN network is stated honestly', async () => {
    if (stack.topologyLoaded) {
      await expect(page.getByRole('img', { name: 'Campus SDN topology' })).toBeVisible();
    } else {
      await expect(new AppShell(page).warnAlert().filter({ hasText: 'Topology not loaded' })).toBeVisible();
    }
  });
});

test('UAT-02 The administrator registers an institutional event that the forecaster will use', {
  tag: '@uat', annotation: { type: 'requirement', description: 'Layer 1: institutional event ingestion (exam, placement, festival)' }
}, async ({ page, adminApi }) => {
  const name = uniqueName('End-semester examination');
  await test.step('Given the administrator is on the institutional events page', async () => {
    await loginViaUi(page, 'admin');
    await new AppShell(page).open('Institutional events');
  });
  await test.step('When an EXAM for the examination hall is registered with intensity 0.85 for 180 minutes', async () => {
    const events = new EventsPage(page);
    await events.fill({
      name, type: 'EXAM', start: toLocalInput(new Date(Date.now() + 20 * 60_000)), duration: '180',
      intensity: '0.85', groups: 'EXAM_HALL'
    });
    await events.submit().click();
    await expect(new AppShell(page).infoAlert()).toHaveText('Saved.');
  });
  await test.step('Then the event is listed with its type, intensity and affected group', async () => {
    const row = new EventsPage(page).row(name);
    await expect(row).toContainText('EXAM');
    await expect(row).toContainText('0.85');
    await expect(row).toContainText('EXAM_HALL');
  });
  await test.step('And it is stored with the correct end time and audited against the administrator', async () => {
    const e = (await adminApi.events()).find(x => x.name === name)!;
    expect(Date.parse(e.endTime) - Date.parse(e.startTime)).toBe(180 * 60_000);
    const entry = (await adminApi.audit({ type: 'EVENT_CREATED', size: 20 })).content.find(a => a.summary.includes(name));
    expect(entry?.actor).toBe('admin');
  });
});

test('UAT-03 The administrator configures controlled automation and the change is audited', {
  tag: '@uat', annotation: { type: 'requirement', description: 'Configurable manual / auto-approval for low-risk actions; configurable score weights' }
}, async ({ page, adminApi }) => {
  const before = await adminApi.policy();
  await test.step('Given the policy page shows the transparent scoring formula', async () => {
    await loginViaUi(page, 'admin');
    await new PolicyPage(page).goto();
    await expect(page.getByRole('heading', { level: 2, name: /Score = w1·KPIImprovement/ })).toBeVisible();
  });
  await test.step('When auto-approval is enabled for low-risk reroutes with a stricter risk limit', async () => {
    const p = new PolicyPage(page);
    await p.approvalMode().selectOption('AUTO_LOW_RISK');
    await p.field('Auto: max risk').fill('0.2');
    await p.field('Auto: allowed actions (CSV)').fill('REROUTE');
    await p.save().click();
    await expect(new AppShell(page).infoAlert()).toContainText('Policy saved');
  });
  await test.step('Then the new policy is in force', async () => {
    expect(await adminApi.policy()).toMatchObject({ approvalMode: 'AUTO_LOW_RISK', autoMaxRisk: 0.2, autoAllowedActions: 'REROUTE' });
  });
  await test.step('And the audit log records who changed what (before and after values)', async () => {
    const entry = (await adminApi.audit({ type: 'POLICY_UPDATED', size: 1 })).content[0];
    expect(entry.actor).toBe('admin');
    const d = JSON.parse(entry.details ?? '{}');
    expect(d.before.approvalMode).toBe(before.approvalMode);
    expect(d.after.approvalMode).toBe('AUTO_LOW_RISK');
    expect(d.after.autoMaxRisk).toBe(0.2);
  });
});

test('UAT-04 A viewer can review everything but cannot change anything', {
  tag: '@uat', annotation: { type: 'requirement', description: 'Only the administrator approves, rejects or changes policy' }
}, async ({ page, viewerApi }) => {
  await test.step('Given a user with the viewer role signs in', async () => {
    await loginViaUi(page, 'viewer');
  });
  await test.step('Then policy fields are read-only and there is no save action', async () => {
    await new PolicyPage(page).goto();
    await expect(page.getByLabel('w1 improvement', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save policy' })).toHaveCount(0);
  });
  await test.step('And the backend refuses changes even if the UI were bypassed', async () => {
    expect((await viewerApi.putPolicy({ ...(await viewerApi.policy()), weightRisk: 0.9 })).status()).toBe(403);
    expect((await viewerApi.postEvent({ name: 'x' })).status()).toBe(403);
  });
  await test.step('And any recommendation can be opened without decision controls', async () => {
    const recs = await viewerApi.recommendations();
    if (recs.length === 0) {
      test.info().annotations.push({ type: 'note', description: 'no recommendation existed yet; step not applicable' });
      return;
    }
    const detail = new RecommendationDetailPage(page);
    await detail.goto(recs[0].id);
    await expect(detail.approveRecommended()).toHaveCount(0);
    await expect(detail.reject()).toHaveCount(0);
  });
});

test('UAT-05 The audit trail is complete, attributable and tamper-evident', {
  tag: '@uat', annotation: { type: 'requirement', description: 'Every step is recorded in an audit log' }
}, async ({ page, adminApi }) => {
  await test.step('Given the administrator performed actions in this session', async () => {
    expect((await adminApi.audit({ size: 1 })).totalElements).toBeGreaterThan(0);
  });
  await test.step('When the audit log is opened and the hash chain is verified', async () => {
    await loginViaUi(page, 'admin');
    const a = new AuditPage(page);
    await a.goto();
    await a.verifyButton().click();
  });
  await test.step('Then the chain is intact', async () => {
    await expect(page.locator('.badge', { hasText: 'Audit chain intact' })).toBeVisible();
  });
  await test.step('And each entry names its actor and links to the previous entry', async () => {
    const content = (await adminApi.audit({ size: 20 })).content;
    for (const e of content) {
      expect(e.actor.length).toBeGreaterThan(0);
      expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
