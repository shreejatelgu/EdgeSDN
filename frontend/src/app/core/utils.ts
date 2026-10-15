// Framework-free helpers. No Angular imports here: these functions are unit-tested directly
// by the Playwright test runner (tests/unit).

export type BadgeKind = 'ok' | 'warn' | 'bad' | 'info';

const OK_STATUSES = ['VERIFIED', 'SELECTABLE', 'UP', 'APPROVED', 'AUTO_APPROVED'];
const WARN_STATUSES = ['PENDING_APPROVAL', 'SIMULATING', 'APPLYING', 'MONITORING', 'NO_GAIN', 'EXPIRED',
  'NO_ACTION_RECOMMENDED'];
const BAD_STATUSES = ['FAILED', 'ROLLED_BACK', 'REJECTED', 'SIMULATION_FAILED', 'DOWN'];

/** Colour class of a status badge. Unknown statuses are neutral ("info"). */
export function statusKind(value: string | null | undefined): BadgeKind {
  const v = value ?? '';
  if (OK_STATUSES.includes(v)) { return 'ok'; }
  if (WARN_STATUSES.includes(v)) { return 'warn'; }
  if (BAD_STATUSES.includes(v)) { return 'bad'; }
  return 'info';
}

/** 0.734 -> "73%". null/undefined/NaN -> "—". */
export function formatPct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) { return '—'; }
  return `${(v * 100).toFixed(digits)}%`;
}

/** Fixed decimals. null/undefined/NaN -> "—". */
export function formatNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) { return '—'; }
  return v.toFixed(digits);
}

/** Readable message from an HttpErrorResponse-like object (backend ApiError body preferred). */
export function errorMessage(err: unknown): string {
  if (!err) { return 'Unknown error'; }
  const e = err as { error?: unknown; status?: number; message?: string };
  const body = e.error;
  if (body && typeof body === 'object') {
    const msg = (body as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.length > 0) { return msg; }
  }
  if (typeof body === 'string' && body.length > 0 && body.length < 500) { return body; }
  if (e.status === 0) { return 'Backend unreachable'; }
  if (typeof e.message === 'string' && e.message.length > 0) { return e.message; }
  return e.status !== undefined ? `HTTP ${e.status}` : 'Unknown error';
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) { return fallback; }
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

/** '{"a":0.1,"b":0.2}' -> [{key:"a",value:0.1}, {key:"b",value:0.2}]. Anything else -> []. */
export function jsonEntries(json: string | null | undefined): { key: string; value: number }[] {
  const o = parseJson<unknown>(json, null);
  if (!o || typeof o !== 'object' || Array.isArray(o)) { return []; }
  const rec = o as Record<string, number>;
  return Object.keys(rec).map(key => ({ key, value: rec[key] }));
}

/** HTTP Basic header value; UTF-8 safe (Spring Security decodes Basic credentials as UTF-8). */
export function basicAuthHeader(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return 'Basic ' + btoa(binary);
}

/** Recommendation statuses whose data can still change (keep refreshing the detail view). */
export const LIVE_RECOMMENDATION_STATUSES = ['SIMULATING', 'APPROVED', 'AUTO_APPROVED', 'APPLYING', 'MONITORING'];

export function needsRefresh(prev: { status: string; updatedAt: string } | null,
                             next: { status: string; updatedAt: string }): boolean {
  return !prev
    || prev.status !== next.status
    || prev.updatedAt !== next.updatedAt
    || LIVE_RECOMMENDATION_STATUSES.includes(next.status);
}

/** Audit filter form values -> query values (blank -> null, ids must be positive integers). */
export function normaliseAuditFilter(type: string | null | undefined, recId: unknown):
  { type: string | null; recommendationId: number | null } {
  const t = (type ?? '').trim().toUpperCase();
  let r: number | null = null;
  if (recId !== null && recId !== undefined && recId !== '') {
    const n = Number(recId);
    r = Number.isInteger(n) && n > 0 ? n : null;
  }
  return { type: t.length > 0 ? t : null, recommendationId: r };
}
