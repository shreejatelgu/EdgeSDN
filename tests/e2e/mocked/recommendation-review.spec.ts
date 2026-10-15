import { expect, test } from '@playwright/test';
import { MockBackend } from '../../fixtures/mock-backend';
import { recommendationView } from '../../fixtures/mock-data';
import { AppShell, RecommendationDetailPage } from '../../fixtures/pages';

test.describe('Recommendation review - explanation package (mocked backend)', () => {
  test('pending recommendation shows prediction, factors, human impact, both options and twin KPIs', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    const view = mock.state.recommendations[0];
    const [selected, alternative, failed] = view.candidates;
    const detail = new RecommendationDetailPage(page);
    await detail.goto(42);

    await expect(detail.title()).toContainText('Recommendation #42');
    await expect(detail.title()).toContainText('PENDING_APPROVAL');
    await expect(page.locator('.alert.warn')).toContainText('Manual approval mode');

    const prediction = detail.section('1 · Prediction');
    await expect(prediction).toContainText(view.recommendation.factualExplanation);
    await expect(prediction.getByRole('row').filter({ hasText: 'event:Semester Examination' })).toContainText('31 pp');
    await expect(prediction).toContainText("Without event 'Semester Examination' the prediction would be 66%");

    await expect(detail.section('2 · Human impact')).toContainText('Examination Hall (~300 users) will take the alternate path');

    await expect(detail.recommendedCard()).toContainText(selected.description);
    await expect(detail.recommendedCard()).toContainText(selected.score.toFixed(3));
    await expect(detail.recommendedCard()).toContainText('risk · priorityImpact');
    await expect(detail.alternativeCard()).toContainText('Alternative (not selected)');
    await expect(detail.alternativeCard()).toContainText(alternative.description);
    await expect(detail.alternativeCard()).toContainText(alternative.score.toFixed(3));

    const decision = detail.section('3 · Recommended action vs alternative');
    await expect(decision).toContainText(view.recommendation.whySelected!);
    await expect(decision).toContainText(view.recommendation.whyNotAlternative!);
    await expect(decision).toContainText(view.recommendation.counterfactual!);

    await expect(detail.kpiRow('Target link utilisation').locator('td')).toHaveText(['Target link utilisation', '98%', '61%', '74%']);
    await expect(detail.kpiRow('Protected latency (ms)').locator('td')).toHaveText(['Protected latency (ms)', '45.2', '12.4', '20.3']);
    await expect(detail.kpiRow('Protected loss (%)').locator('td')).toHaveText(['Protected loss (%)', '12.4', '0.8', '2.1']);

    await expect(detail.candidateRows()).toHaveCount(3);
    await expect(detail.candidateRows().nth(2)).toContainText('SIMULATION_FAILED');
    await expect(detail.candidateRows().nth(2)).toContainText(failed.note!);
    await expect(detail.section('All candidates')).toContainText('Score = w1·KPIImprovement + w2·Confidence − w3·Risk');

    await expect(detail.auditRows()).toHaveCount(4);
    await expect(detail.decisionPanel()).toBeVisible();
  });

  test('approving the recommended action sends no candidate id and records the comment', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    const detail = new RecommendationDetailPage(page);
    await detail.goto(42);
    await detail.comment().fill('Approved during exam window');
    await detail.approveRecommended().click();

    const call = await mock.waitForCall('POST', /\/api\/recommendations\/42\/approve$/);
    expect(call.body).toEqual({ candidateId: null, comment: 'Approved during exam window' });
    await expect(new AppShell(page).infoAlert()).toHaveText('Decision recorded. Status: MONITORING');
    await expect(detail.title()).toContainText('MONITORING');
    await expect(detail.decisionPanel()).toHaveCount(0);
    await expect(page.getByText(/Decision: MONITORING by admin/)).toBeVisible();
  });

  test('the administrator can approve the alternative instead', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    const alternativeId = mock.state.recommendations[0].candidates[1].id;
    const detail = new RecommendationDetailPage(page);
    await detail.goto(42);
    await detail.approveAlternative().click();
    const call = await mock.waitForCall('POST', /\/api\/recommendations\/42\/approve$/);
    expect(call.body.candidateId).toBe(alternativeId);
  });

  test('rejecting sends the reason and closes the decision', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    const detail = new RecommendationDetailPage(page);
    await detail.goto(42);
    await detail.comment().fill('Too risky during the placement drive');
    await detail.reject().click();
    const call = await mock.waitForCall('POST', /\/api\/recommendations\/42\/reject$/);
    expect(call.body).toEqual({ reason: 'Too risky during the placement drive' });
    await expect(new AppShell(page).infoAlert()).toHaveText('Rejected.');
    await expect(detail.title()).toContainText('REJECTED');
    await expect(detail.decisionPanel()).toHaveCount(0);
    expect(mock.callsTo('POST', /approve$/)).toHaveLength(0);
  });

  test('an alternative that failed twin simulation can never be approved', async ({ page }) => {
    const mock = await new MockBackend(page, s => {
      const v = recommendationView(45, 'PENDING_APPROVAL');
      v.recommendation.alternativeCandidateId = v.candidates[2].id; // the SIMULATION_FAILED one
      s.recommendations.unshift(v);
    }).install('admin');
    const detail = new RecommendationDetailPage(page);
    await detail.goto(45);
    await expect(detail.alternativeCard()).toContainText('SIMULATION_FAILED');
    await expect(detail.approveRecommended()).toBeVisible();
    await expect(detail.approveAlternative()).toHaveCount(0);
    expect(mock.callsTo('POST', /approve$/)).toHaveLength(0);
  });

  test('a viewer sees the full explanation but no decision controls', async ({ page }) => {
    await new MockBackend(page).install('viewer');
    const detail = new RecommendationDetailPage(page);
    await detail.goto(42);
    await expect(detail.section('1 · Prediction')).toBeVisible();
    await expect(detail.recommendedCard()).toBeVisible();
    await expect(detail.decisionPanel()).toHaveCount(0);
    await expect(detail.approveRecommended()).toHaveCount(0);
    await expect(detail.reject()).toHaveCount(0);
  });

  test('a conflict from the backend (e.g. expired recommendation) is shown to the administrator', async ({ page }) => {
    await new MockBackend(page).on('POST', /\/approve$/, () => ({
      status: 409, json: { status: 409, error: 'Conflict', message: 'Recommendation 42 has expired; the network state may have changed' }
    })).install('admin');
    const detail = new RecommendationDetailPage(page);
    await detail.goto(42);
    await detail.approveRecommended().click();
    await expect(new AppShell(page).errorAlert()).toHaveText('Recommendation 42 has expired; the network state may have changed');
    await expect(detail.approveRecommended()).toBeEnabled();
  });

  test('while the twin is simulating, progress is shown and the page updates by itself', async ({ page }) => {
    const mock = await new MockBackend(page, s => { s.recommendations.unshift(recommendationView(43, 'SIMULATING')); }).install('admin');
    const detail = new RecommendationDetailPage(page);
    await detail.goto(43);
    await expect(page.getByText('Candidates are being simulated in the Mininet digital twin')).toBeVisible();
    await expect(detail.decisionPanel()).toHaveCount(0);

    mock.state.recommendations[0] = recommendationView(43, 'PENDING_APPROVAL');
    await expect(detail.decisionPanel()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Candidates are being simulated')).toHaveCount(0);
    await expect(detail.recommendedCard()).toBeVisible();
  });

  test('"no action recommended" explains why and offers no decision', async ({ page }) => {
    await new MockBackend(page).install('admin');
    const detail = new RecommendationDetailPage(page);
    await detail.goto(44);
    await expect(page.getByRole('heading', { name: 'No action recommended' })).toBeVisible();
    await expect(page.getByText('No candidate improved KPIs by more than 0.050')).toBeVisible();
    await expect(detail.decisionPanel()).toHaveCount(0);
    await expect(detail.recommendedCard()).toHaveCount(0);
  });

  test('unknown recommendation shows the backend error', async ({ page }) => {
    await new MockBackend(page).install('admin');
    await page.goto('/#/recommendations/999');
    await expect(new AppShell(page).errorAlert()).toHaveText('Recommendation 999 not found');
  });
});

test.describe('Recommendation list (mocked backend)', () => {
  test('lists recommendations with status badges and filters by status', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    await page.goto('/#/recommendations');
    const rows = page.locator('table tr:has(td)');
    await expect(rows).toHaveCount(mock.state.recommendations.length);
    await page.locator('label').filter({ hasText: /^\s*Status filter/ }).locator('select').selectOption('PENDING_APPROVAL');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('#42');
    const filtered = mock.callsTo('GET', /^\/api\/recommendations$/).filter(c => c.query.get('status') === 'PENDING_APPROVAL');
    expect(filtered.length).toBeGreaterThan(0);
  });

  test('"Evaluate network now" triggers a forecast and reports the run', async ({ page }) => {
    const mock = await new MockBackend(page).install('admin');
    await page.goto('/#/recommendations');
    await page.getByRole('button', { name: 'Evaluate network now' }).click();
    await mock.waitForCall('POST', /\/api\/recommendations\/evaluate$/);
    await expect(new AppShell(page).infoAlert()).toContainText('Forecast run run-mock-2 (RULE_BASED) done');
  });

  test('viewer cannot trigger an evaluation', async ({ page }) => {
    await new MockBackend(page).install('viewer');
    await page.goto('/#/recommendations');
    await expect(page.locator('table tr:has(td)').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Evaluate network now' })).toHaveCount(0);
  });
});
