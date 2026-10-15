import { EdgeApi, apiContext, expectStatus } from '../fixtures/api';
import { BOTTLENECK, resetClosedLoop, triggerCongestion, waitForStatus, withPolicy } from '../fixtures/closed-loop';
import { ENV } from '../fixtures/env';
import { expect, loginViaUi, probeStack, requireNetwork, test } from '../fixtures/fixtures';
import { AppShell, EnforcementsPage, RecommendationDetailPage } from '../fixtures/pages';

/**
 * User acceptance - the closed loop on the emulated campus network:
 * prediction -> twin-validated candidates -> explained recommendation -> human (or policy) decision ->
 * enforcement through OpenDaylight -> monitoring -> verification or automatic rollback -> audit.
 * Needs the twin-agent (Mininet) and OpenDaylight; skipped otherwise (EDGE_REQUIRE_NETWORK=1 to fail instead).
 * Congestion is created with a labelled demo forecast override, exactly as in the documented demo.
 */
test.describe.configure({ mode: 'serial' });

test.beforeEach(({ stack }) => requireNetwork(stack));

test.afterEach(async ({ adminApi, stack }) => {
  if (!stack.networkReady) { return; }
  await adminApi.clearScenarios();
  await adminApi.stopLiveTraffic();
});

test.afterAll(async () => {
  const stack = await probeStack();
  if (!stack.networkReady) { return; }
  const ctx = await apiContext('admin');
  await resetClosedLoop(new EdgeApi(ctx));
  await ctx.dispose();
});

const MANUAL = { approvalMode: 'MANUAL' as const, monitorWindowSec: 60 };

test('UAT-06 Predicted congestion is handled end-to-end with administrator approval', {
  tag: ['@uat', '@network'],
  annotation: { type: 'requirement', description: 'Prediction -> candidates -> twin validation -> recommendation -> explanation -> review -> approval -> enforcement -> monitoring' }
}, async ({ page, adminApi }) => {
  await withPolicy(adminApi, MANUAL, async () => {
    let recId = 0;
    await test.step('Given the network runs baseline routing and approval is MANUAL', async () => {
      await resetClosedLoop(adminApi);
    });
    await test.step(`When congestion is predicted on ${BOTTLENECK} (labelled demo forecast)`, async () => {
      const rec = await triggerCongestion(adminApi, 'UAT-06 exam surge');
      expect(rec.status, 'the twin must validate at least one improving action').toBe('PENDING_APPROVAL');
      recId = rec.id;
    });
    const detail = new RecommendationDetailPage(page);
    await test.step('Then the administrator sees why action is needed, the options, their twin KPIs and the human impact', async () => {
      await loginViaUi(page, 'admin');
      await detail.goto(recId);
      await expect(detail.title()).toContainText('PENDING_APPROVAL');
      await expect(detail.section('1 · Prediction')).toContainText(BOTTLENECK);
      await expect(detail.section('1 · Prediction')).toContainText('scenario-override');
      await expect(detail.section('2 · Human impact')).toContainText('users');
      await expect(detail.recommendedCard()).toContainText('SELECTABLE');
      await expect(page.getByRole('heading', { name: 'Why this action' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Why not the alternative' })).toBeVisible();
      await expect(detail.kpiRow('Target link utilisation').locator('td').nth(1)).toHaveText(/\d+%/);
      await expect(detail.kpiRow('Target link utilisation').locator('td').nth(2)).toHaveText(/\d+%/);
    });
    await test.step('When the administrator approves the recommended action', async () => {
      await detail.comment().fill('UAT-06 approval');
      await detail.approveRecommended().click();
      await expect(new AppShell(page).infoAlert()).toContainText('Decision recorded');
    });
    await test.step('Then the action is applied through the SDN controller and monitored', async () => {
      await waitForStatus(adminApi, recId, /^(MONITORING|VERIFIED|ROLLED_BACK)$/, 60_000);
      const enf = (await adminApi.enforcements()).find(e => e.recommendationId === recId);
      expect(enf, 'an enforcement record exists').toBeTruthy();
      expect(enf!.appliedBy).toBe(ENV.admin.username);
      expect(JSON.parse(enf!.flowsJson ?? '[]').length).toBeGreaterThan(0);
      expect(enf!.preSnapshotJson).toBeTruthy();
      expect(JSON.parse(enf!.baselineKpiJson ?? '{}')).toHaveProperty('maxLinkUtil');
    });
    await test.step('And the loop closes: the action is verified or automatically rolled back', async () => {
      const outcome = await waitForStatus(adminApi, recId, /^(VERIFIED|ROLLED_BACK)$/, 240_000);
      test.info().annotations.push({ type: 'outcome', description: outcome });
    });
    await test.step('And every step of the decision is in the audit log', async () => {
      const types = (await adminApi.audit({ recommendationId: recId, size: 200 })).content.map(a => a.type);
      expect(types).toEqual(expect.arrayContaining(
        ['RECOMMENDATION_CREATED', 'TWIN_SIMULATED', 'RECOMMENDATION_READY', 'APPROVED', 'ENFORCEMENT_APPLIED']));
      expect(types.some(t => t === 'VERIFIED' || t === 'ROLLED_BACK')).toBe(true);
      expect((await adminApi.verifyAudit()).valid).toBe(true);
    });
  });
});

test('UAT-07 A KPI regression after enforcement is rolled back automatically', {
  tag: ['@uat', '@network'],
  annotation: { type: 'requirement', description: 'Automatic rollback on significant KPI regression' }
}, async ({ page, adminApi }) => {
  await withPolicy(adminApi, { approvalMode: 'MANUAL', monitorWindowSec: 300 }, async () => {
    let recId = 0;
    await test.step('Given an approved action is being monitored', async () => {
      await resetClosedLoop(adminApi);
      const rec = await triggerCongestion(adminApi, 'UAT-07 rollback');
      expect(rec.status).toBe('PENDING_APPROVAL');
      recId = rec.id;
      await expectStatus(await adminApi.approve(recId, null, 'UAT-07'), 200);
      await waitForStatus(adminApi, recId, /^MONITORING$/, 60_000);
    });
    let enfId = 0;
    await test.step('When a regression appears (demo injection from the Enforcements page, clearly labelled)', async () => {
      enfId = (await adminApi.enforcements()).find(e => e.recommendationId === recId)!.id;
      await loginViaUi(page, 'admin');
      const p = new EnforcementsPage(page);
      await p.goto();
      page.once('dialog', d => void d.accept());
      await p.inject(enfId).click();
      await expect(new AppShell(page).infoAlert()).toContainText('Synthetic regression injected');
    });
    await test.step('Then the monitor rolls the action back within a few samples', async () => {
      await waitForStatus(adminApi, recId, /^ROLLED_BACK$/, 120_000);
      await expect(new EnforcementsPage(page).row(enfId)).toContainText('ROLLED_BACK', { timeout: 15_000 });
    });
    await test.step('And the rollback is attributed to the monitor and explains the cause', async () => {
      const enf = (await adminApi.enforcements()).find(e => e.id === enfId)!;
      expect(enf.endReason).toContain('Automatic rollback');
      expect(enf.endReason).toContain('DEMO');
      const audit = (await adminApi.audit({ recommendationId: recId, size: 200 })).content;
      expect(audit.find(a => a.type === 'REGRESSION_DETECTED')?.actor).toBe('SYSTEM:monitor');
      expect(audit.find(a => a.type === 'ROLLED_BACK')?.actor).toBe('SYSTEM:monitor');
      expect(audit.find(a => a.type === 'DEMO_REGRESSION_INJECTED')?.actor).toBe(ENV.admin.username);
    });
  });
});

test('UAT-08 The administrator rejects a recommendation and nothing is applied', {
  tag: ['@uat', '@network'],
  annotation: { type: 'requirement', description: 'Administrator can reject; rejected actions never reach enforcement' }
}, async ({ page, adminApi }) => {
  await withPolicy(adminApi, MANUAL, async () => {
    let recId = 0;
    await test.step('Given a pending recommendation', async () => {
      await resetClosedLoop(adminApi);
      const rec = await triggerCongestion(adminApi, 'UAT-08 reject');
      expect(rec.status).toBe('PENDING_APPROVAL');
      recId = rec.id;
    });
    await test.step('When the administrator rejects it with a reason', async () => {
      await loginViaUi(page, 'admin');
      const detail = new RecommendationDetailPage(page);
      await detail.goto(recId);
      await detail.comment().fill('Maintenance window - do not touch the core');
      await detail.reject().click();
      await expect(new AppShell(page).infoAlert()).toHaveText('Rejected.');
    });
    await test.step('Then it is closed, nothing reached the controller, and the reason is audited', async () => {
      expect((await adminApi.recommendation(recId)).recommendation).toMatchObject({
        status: 'REJECTED', decidedBy: ENV.admin.username, decisionComment: 'Maintenance window - do not touch the core'
      });
      expect((await adminApi.enforcements()).some(e => e.recommendationId === recId)).toBe(false);
      const rejected = (await adminApi.audit({ recommendationId: recId, type: 'REJECTED' })).content[0];
      expect(rejected.summary).toContain('Maintenance window');
      expect((await adminApi.approve(recId)).status(), 'a rejected recommendation cannot be approved later').toBe(409);
    });
  });
});

test('UAT-09 Auto-approval applies only low-risk actions allowed by policy', {
  tag: ['@uat', '@network'],
  annotation: { type: 'requirement', description: 'Configurable auto-approval for low-risk actions' }
}, async ({ adminApi }) => {
  await test.step('Given a permissive AUTO_LOW_RISK policy, the recommended action is approved by policy', async () => {
    await withPolicy(adminApi, {
      approvalMode: 'AUTO_LOW_RISK', autoMaxRisk: 1, autoMinScore: -1, autoMinConfidence: 0,
      autoAllowedActions: 'REROUTE,RATE_LIMIT', autoMaxPerHour: 60, monitorWindowSec: 30
    }, async () => {
      await resetClosedLoop(adminApi);
      const rec = await triggerCongestion(adminApi, 'UAT-09 auto');
      // the policy decision follows immediately after PENDING_APPROVAL: wait for it
      await waitForStatus(adminApi, rec.id, /^(AUTO_APPROVED|APPLYING|MONITORING|VERIFIED|ROLLED_BACK)$/, 60_000);
      const r = (await adminApi.recommendation(rec.id)).recommendation;
      expect(r.decidedBy).toBe('SYSTEM:auto-policy');
      expect(r.autoApprovalNote).toMatch(/^Auto-approved: risk/);
      const audit = (await adminApi.audit({ recommendationId: rec.id, type: 'AUTO_APPROVED' })).content;
      expect(audit).toHaveLength(1);
    });
  });
  await test.step('Given a strict policy (max risk 0), the same situation waits for the administrator and says why', async () => {
    await withPolicy(adminApi, {
      approvalMode: 'AUTO_LOW_RISK', autoMaxRisk: 0, autoMinScore: -1, autoMinConfidence: 0,
      autoAllowedActions: 'REROUTE,RATE_LIMIT', autoMaxPerHour: 60
    }, async () => {
      await resetClosedLoop(adminApi);
      const rec = await triggerCongestion(adminApi, 'UAT-09 strict');
      await expect.poll(async () => (await adminApi.recommendation(rec.id)).recommendation.autoApprovalNote ?? '',
        { timeout: 30_000 }).toMatch(/^Auto-approval not applied/);
      const r = (await adminApi.recommendation(rec.id)).recommendation;
      expect(r.status).toBe('PENDING_APPROVAL');
      expect(r.decidedBy).toBeNull();
      expect(r.autoApprovalNote).toMatch(/^Auto-approval not applied: risk [\d.]+ > max 0\.000/);
      expect((await adminApi.audit({ recommendationId: rec.id, type: 'AUTO_APPROVAL_SKIPPED' })).content).toHaveLength(1);
      await adminApi.reject(rec.id, 'UAT-09 clean-up');
    });
  });
});
