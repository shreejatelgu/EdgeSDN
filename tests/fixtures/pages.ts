import { expect, type Locator, type Page } from '@playwright/test';

/** Selects the <select> wrapped by the <label> whose text starts with `text`. */
function selectIn(page: Page, text: string): Locator {
  return page.locator('label').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(text)}`) }).locator('select');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Data rows (rows that contain <td> cells) of the tables on the page. */
function dataRows(scope: Page | Locator): Locator {
  return scope.locator('table tr:has(td)');
}

export class AppShell {
  constructor(readonly page: Page) {}
  nav(): Locator { return this.page.getByRole('navigation'); }
  link(name: string): Locator { return this.nav().getByRole('link', { name, exact: true }); }
  async open(section: string): Promise<void> { await this.link(section).click(); }
  /** "<username> (<role>)" block at the bottom of the navigation (also contains the "Log out" link). */
  userLabel(): Locator { return this.nav().locator('.user'); }
  async logout(): Promise<void> { await this.nav().getByRole('link', { name: 'Log out' }).click(); }
  errorAlert(): Locator { return this.page.locator('.alert.error'); }
  infoAlert(): Locator { return this.page.locator('.alert.info'); }
  warnAlert(): Locator { return this.page.locator('.alert.warn'); }
  heading(name: string | RegExp): Locator { return this.page.getByRole('heading', { name, level: 1 }); }
}

export const NAV_SECTIONS: { link: string; heading: string | RegExp }[] = [
  { link: 'Dashboard', heading: 'Dashboard' },
  { link: 'Recommendations', heading: 'Recommendations' },
  { link: 'Enforcements', heading: 'Enforcements (applied actions)' },
  { link: 'Predictions', heading: 'Predictions' },
  { link: 'Telemetry', heading: 'Telemetry' },
  { link: 'Institutional events', heading: 'Institutional events' },
  { link: 'Policy', heading: 'Policy' },
  { link: 'Audit log', heading: 'Audit log' },
  { link: 'Network & demo', heading: 'Network & demo control' }
];

export class LoginPage {
  constructor(readonly page: Page) {}
  async goto(): Promise<void> { await this.page.goto('/#/login'); await expect(this.title()).toBeVisible(); }
  title(): Locator { return this.page.getByRole('heading', { name: 'EDGE-SDN Console' }); }
  async login(username: string, password: string): Promise<void> {
    await this.page.getByLabel('Username').fill(username);
    await this.page.getByLabel('Password').fill(password);
    await this.page.getByRole('button', { name: 'Sign in' }).click();
  }
  error(): Locator { return this.page.locator('.alert.error'); }
}

export interface EventFormValues {
  name?: string; type?: string; start?: string; duration?: string; intensity?: string; groups?: string; description?: string;
}

export class EventsPage {
  constructor(readonly page: Page) {}
  async goto(): Promise<void> {
    await this.page.goto('/#/events');
    await expect(this.page.getByRole('heading', { name: 'Institutional events', level: 1 })).toBeVisible();
  }
  name(): Locator { return this.page.getByLabel('Name', { exact: true }); }
  type(): Locator { return selectIn(this.page, 'Type'); }
  start(): Locator { return this.page.getByLabel('Start (local time)'); }
  duration(): Locator { return this.page.getByLabel('Duration (min)'); }
  intensity(): Locator { return this.page.getByLabel('Expected intensity (0-1)'); }
  groups(): Locator { return this.page.getByLabel('Affected groups (comma-separated)'); }
  description(): Locator { return this.page.getByLabel('Description', { exact: true }); }
  submit(): Locator { return this.page.getByRole('button', { name: /^(Create|Update)$/ }); }
  row(text: string): Locator { return dataRows(this.page).filter({ hasText: text }); }
  csv(): Locator { return this.page.locator('textarea'); }
  importButton(): Locator { return this.page.getByRole('button', { name: 'Import', exact: true }); }
  async fill(v: EventFormValues): Promise<void> {
    if (v.name !== undefined) { await this.name().fill(v.name); }
    if (v.type !== undefined) { await this.type().selectOption(v.type); }
    if (v.start !== undefined) { await this.start().fill(v.start); }
    if (v.duration !== undefined) { await this.duration().fill(v.duration); }
    if (v.intensity !== undefined) { await this.intensity().fill(v.intensity); }
    if (v.groups !== undefined) { await this.groups().fill(v.groups); }
    if (v.description !== undefined) { await this.description().fill(v.description); }
  }
}

export class PolicyPage {
  constructor(readonly page: Page) {}
  async goto(): Promise<void> {
    await this.page.goto('/#/policy');
    await expect(this.page.getByRole('heading', { name: 'Policy', level: 1 })).toBeVisible();
    await expect(this.field('w1 improvement')).toBeVisible();
  }
  field(label: string): Locator { return this.page.getByLabel(label, { exact: true }); }
  approvalMode(): Locator { return selectIn(this.page, 'Approval mode'); }
  save(): Locator { return this.page.getByRole('button', { name: 'Save policy' }); }
}

export class AuditPage {
  constructor(readonly page: Page) {}
  async goto(): Promise<void> {
    await this.page.goto('/#/audit');
    await expect(this.page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
  }
  typeFilter(): Locator { return this.page.getByLabel('Type', { exact: true }); }
  recFilter(): Locator { return this.page.getByLabel('Recommendation #'); }
  filterButton(): Locator { return this.page.getByRole('button', { name: 'Filter' }); }
  verifyButton(): Locator { return this.page.getByRole('button', { name: 'Verify hash chain' }); }
  rows(): Locator { return dataRows(this.page); }
  typeCell(row: Locator): Locator { return row.locator('td').nth(2); }
}

export class RecommendationDetailPage {
  constructor(readonly page: Page) {}
  async goto(id: number): Promise<void> {
    await this.page.goto(`/#/recommendations/${id}`);
    await expect(this.title()).toBeVisible();
  }
  title(): Locator { return this.page.getByRole('heading', { level: 1, name: /Recommendation #\d+/ }); }
  /** The panel whose <h2> starts with `prefix` (e.g. "1 · Prediction"). */
  section(prefix: string): Locator {
    return this.page.locator('.panel').filter({
      has: this.page.getByRole('heading', { level: 2, name: new RegExp(`^${escapeRegExp(prefix)}`) })
    });
  }
  recommendedCard(): Locator { return this.page.locator('.card-selected'); }
  alternativeCard(): Locator { return this.page.locator('.card-alt'); }
  kpiRow(label: string): Locator { return this.page.getByRole('row').filter({ hasText: label }); }
  comment(): Locator { return this.page.getByLabel('Comment / reason'); }
  approveRecommended(): Locator { return this.page.getByRole('button', { name: 'Approve recommended action' }); }
  approveAlternative(): Locator { return this.page.getByRole('button', { name: 'Approve alternative instead' }); }
  reject(): Locator { return this.page.getByRole('button', { name: 'Reject' }); }
  decisionPanel(): Locator { return this.page.getByRole('heading', { level: 2, name: /Administrator decision/ }); }
  candidateRows(): Locator { return this.section('All candidates').locator('tr:has(td)'); }
  auditRows(): Locator { return this.section('Audit trail').locator('tr:has(td)'); }
}

export class EnforcementsPage {
  constructor(readonly page: Page) {}
  async goto(): Promise<void> {
    await this.page.goto('/#/enforcements');
    await expect(this.page.getByRole('heading', { name: 'Enforcements (applied actions)' })).toBeVisible();
  }
  /** Row of enforcement #id (first cell holds the id). */
  row(id: number): Locator {
    return dataRows(this.page).filter({ has: this.page.locator('td:first-child', { hasText: new RegExp(`^\\s*${id}\\s*$`) }) });
  }
  revert(id: number): Locator { return this.row(id).getByRole('button', { name: 'Revert' }); }
  inject(id: number): Locator { return this.row(id).getByRole('button', { name: 'Inject regression (demo)' }); }
}

export class ControlPage {
  constructor(readonly page: Page) {}
  async goto(): Promise<void> {
    await this.page.goto('/#/control');
    await expect(this.page.getByRole('heading', { name: 'Network & demo control' })).toBeVisible();
  }
  demand(cls: string): Locator { return this.page.getByLabel(`${cls} (Mbps)`); }
  duration(): Locator { return this.page.getByLabel('Duration (s)'); }
  link(): Locator { return selectIn(this.page, 'Link'); }
  predicted(): Locator { return this.page.getByLabel('Predicted utilisation (0-1.5)'); }
  confidence(): Locator { return this.page.getByLabel('Confidence (0-1)'); }
  horizon(): Locator { return this.page.getByLabel('Horizon (blank = all)'); }
  activeFor(): Locator { return this.page.getByLabel('Active for (min)'); }
  note(): Locator { return this.page.getByLabel('Note', { exact: true }); }
  button(name: string): Locator { return this.page.getByRole('button', { name, exact: true }); }
  scenarioRows(): Locator { return this.page.locator('table tr:has(td)'); }
}
