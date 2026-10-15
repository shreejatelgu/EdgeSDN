/** Test-run configuration. Every value can be overridden with an environment variable. */
export const ENV = {
  uiUrl: process.env.EDGE_UI_URL ?? 'http://localhost:4200',
  backendUrl: process.env.EDGE_BACKEND_URL ?? 'http://localhost:8080',
  agentUrl: process.env.EDGE_AGENT_URL ?? 'http://192.168.56.101:8000',
  agentToken: process.env.EDGE_AGENT_TOKEN ?? 'change-me-agent-token',
  mlUrl: process.env.EDGE_ML_URL ?? 'http://localhost:8001',
  mlApiKey: process.env.EDGE_ML_API_KEY ?? '',
  admin: {
    username: process.env.EDGE_ADMIN_USER ?? 'admin',
    password: process.env.EDGE_ADMIN_PASSWORD ?? 'admin123'
  },
  viewer: {
    username: process.env.EDGE_VIEWER_USER ?? 'viewer',
    password: process.env.EDGE_VIEWER_PASSWORD ?? 'viewer123'
  },
  /** "1" = fail (instead of skip) when the Mininet network / OpenDaylight is unavailable. */
  requireNetwork: process.env.EDGE_REQUIRE_NETWORK === '1',
  /** "1" = fail (instead of skip) when the twin-agent is unreachable. */
  requireAgent: process.env.EDGE_REQUIRE_AGENT === '1',
  /** "1" = fail (instead of skip) when the ML service is unreachable. */
  requireMl: process.env.EDGE_REQUIRE_ML === '1',
  /** Prefix of every record the tests create; used to find and delete them afterwards. */
  prefix: 'PW-TEST'
};

export type Role = 'admin' | 'viewer';

export function basicAuth(role: Role): string {
  const c = ENV[role];
  return 'Basic ' + Buffer.from(`${c.username}:${c.password}`, 'utf8').toString('base64');
}

/** Unique, recognisable name for test data, e.g. "PW-TEST Exam lz3k9x-4f2a". */
export function uniqueName(label: string): string {
  return `${ENV.prefix} ${label} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
