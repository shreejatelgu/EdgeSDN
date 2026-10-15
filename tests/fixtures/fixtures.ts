import { test as base, expect, type Page } from '@playwright/test';
import { EdgeApi, apiContext } from './api';
import { ENV, basicAuth, type Role } from './env';

/** What parts of the stack are running (probed once per worker through the backend). */
export interface StackState {
  backendUp: boolean;
  topologyLoaded: boolean;
  controllerReachable: boolean;
  agentUp: boolean;
  /** twin-agent + OpenDaylight with switches connected: required for the closed-loop scenarios. */
  networkReady: boolean;
  mlReachable: boolean;
}

type TestFixtures = { adminApi: EdgeApi; viewerApi: EdgeApi; anonApi: EdgeApi };
type WorkerFixtures = { stack: StackState };

export const test = base.extend<TestFixtures, WorkerFixtures>({
  stack: [async ({}, use) => { await use(await probeStack()); }, { scope: 'worker' }],
  adminApi: async ({}, use) => {
    const ctx = await apiContext('admin');
    await use(new EdgeApi(ctx));
    await ctx.dispose();
  },
  viewerApi: async ({}, use) => {
    const ctx = await apiContext('viewer');
    await use(new EdgeApi(ctx));
    await ctx.dispose();
  },
  anonApi: async ({}, use) => {
    const ctx = await apiContext('anonymous');
    await use(new EdgeApi(ctx));
    await ctx.dispose();
  }
});

export { expect };

export async function probeStack(): Promise<StackState> {
  const down: StackState = {
    backendUp: false, topologyLoaded: false, controllerReachable: false, agentUp: false,
    networkReady: false, mlReachable: false
  };
  const ctx = await apiContext('admin');
  try {
    const res = await ctx.get('/api/system/health', { timeout: 20_000 }).catch(() => null);
    if (!res || !res.ok()) { return down; }
    const h = await res.json();
    const topologyLoaded = h.topologyLoaded === true;
    const controllerReachable = h.controller?.reachable === true && (h.controller?.connectedSwitches ?? 0) > 0;
    const agentUp = h.agent?.status === 'UP';
    const ml = await ctx.get('/api/ml/status', { timeout: 20_000 }).catch(() => null);
    const mlReachable = !!ml && ml.ok() && (await ml.json()).reachable === true;
    return {
      backendUp: true, topologyLoaded, controllerReachable, agentUp,
      networkReady: topologyLoaded && controllerReachable && agentUp, mlReachable
    };
  } finally {
    await ctx.dispose();
  }
}

/** Fails fast with a clear message when the backend is not running. */
export function requireBackend(stack: StackState): void {
  expect(stack.backendUp, `Backend must be running at ${ENV.backendUrl} (SETUP_GUIDE step 9)`).toBe(true);
}

/** Skips the test (or fails it with EDGE_REQUIRE_NETWORK=1) when Mininet + OpenDaylight are not available. */
export function requireNetwork(stack: StackState): void {
  requireBackend(stack);
  const reason = 'Needs the twin-agent (Mininet) and OpenDaylight with connected switches (SETUP_GUIDE steps 4-6)';
  if (ENV.requireNetwork) {
    expect(stack.networkReady, reason).toBe(true);
  } else {
    test.skip(!stack.networkReady, reason);
  }
}

/** Skips unless the backend currently has NO topology (negative-path tests for a missing twin-agent). */
export function requireNoTopology(stack: StackState): void {
  requireBackend(stack);
  test.skip(stack.topologyLoaded, 'Only meaningful while the twin-agent is unreachable');
}

/** Logs in through the real login form. */
export async function loginViaUi(page: Page, role: Role): Promise<void> {
  await page.goto('/#/login');
  await page.getByLabel('Username').fill(ENV[role].username);
  await page.getByLabel('Password').fill(ENV[role].password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

/**
 * Stores real credentials in sessionStorage before the app boots (skips the login form in tests that
 * are not about login). The backend still authenticates every request.
 */
export async function seedSession(page: Page, role: Role): Promise<void> {
  const value = JSON.stringify({
    token: basicAuth(role),
    me: { username: ENV[role].username, roles: [role === 'admin' ? 'ROLE_ADMIN' : 'ROLE_VIEWER'] }
  });
  await page.addInitScript(v => window.sessionStorage.setItem('edge-sdn-auth', v), value);
}
