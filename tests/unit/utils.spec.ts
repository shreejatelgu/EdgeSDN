import { expect, test } from '@playwright/test';
import {
  LIVE_RECOMMENDATION_STATUSES, basicAuthHeader, errorMessage, formatNum, formatPct, jsonEntries, needsRefresh,
  normaliseAuditFilter, parseJson, statusKind
} from '../../frontend/src/app/core/utils';

test.describe('statusKind - badge colour of every lifecycle status', () => {
  const cases: [string, string][] = [
    ['VERIFIED', 'ok'], ['SELECTABLE', 'ok'], ['UP', 'ok'], ['APPROVED', 'ok'], ['AUTO_APPROVED', 'ok'],
    ['PENDING_APPROVAL', 'warn'], ['SIMULATING', 'warn'], ['APPLYING', 'warn'], ['MONITORING', 'warn'],
    ['NO_GAIN', 'warn'], ['EXPIRED', 'warn'], ['NO_ACTION_RECOMMENDED', 'warn'],
    ['FAILED', 'bad'], ['ROLLED_BACK', 'bad'], ['REJECTED', 'bad'], ['SIMULATION_FAILED', 'bad'], ['DOWN', 'bad'],
    ['REVERTED', 'info'], ['MANUAL', 'info']
  ];
  for (const [status, kind] of cases) {
    test(`${status} -> ${kind}`, () => {
      expect(statusKind(status)).toBe(kind);
    });
  }

  test('empty, null, undefined and lowercase values are neutral', () => {
    expect(statusKind('')).toBe('info');
    expect(statusKind(null)).toBe('info');
    expect(statusKind(undefined)).toBe('info');
    expect(statusKind('verified')).toBe('info');
  });
});

test.describe('formatPct / formatNum', () => {
  test('formats fractions as whole percentages by default', () => {
    expect(formatPct(0.734)).toBe('73%');
    expect(formatPct(0)).toBe('0%');
    expect(formatPct(1)).toBe('100%');
  });

  test('supports decimals and over-100 % loads (utilisation can exceed capacity in forecasts)', () => {
    expect(formatPct(0.7349, 1)).toBe('73.5%');
    expect(formatPct(1.2)).toBe('120%');
  });

  test('missing values render as an em dash, never "NaN%"', () => {
    expect(formatPct(null)).toBe('—');
    expect(formatPct(undefined)).toBe('—');
    expect(formatPct(Number.NaN)).toBe('—');
    expect(formatNum(null)).toBe('—');
    expect(formatNum(Number.NaN, 1)).toBe('—');
  });

  test('formatNum uses fixed decimals', () => {
    expect(formatNum(3.14159)).toBe('3.14');
    expect(formatNum(45.25, 1)).toBe('45.3');
    expect(formatNum(2, 3)).toBe('2.000');
  });
});

test.describe('errorMessage - what the administrator sees when a call fails', () => {
  test('prefers the backend ApiError message', () => {
    const err = { status: 409, message: 'Http failure', error: { status: 409, message: 'Recommendation 5 has expired' } };
    expect(errorMessage(err)).toBe('Recommendation 5 has expired');
  });

  test('uses a short plain-text body (e.g. proxy error text)', () => {
    expect(errorMessage({ status: 500, message: 'Http failure', error: 'Error occurred while trying to proxy' }))
      .toBe('Error occurred while trying to proxy');
  });

  test('ignores empty or huge bodies and falls back to the transport message', () => {
    expect(errorMessage({ status: 500, message: 'Http failure response', error: '' })).toBe('Http failure response');
    expect(errorMessage({ status: 500, message: 'Http failure response', error: 'x'.repeat(600) })).toBe('Http failure response');
    expect(errorMessage({ status: 500, message: 'Http failure response', error: { message: '' } })).toBe('Http failure response');
  });

  test('status 0 means the backend could not be reached', () => {
    // Angular puts a ProgressEvent (no "message") into `error` for network failures.
    expect(errorMessage({ status: 0, message: 'Http failure response: 0 Unknown Error', error: { type: 'error' } }))
      .toBe('Backend unreachable');
  });

  test('falls back to the HTTP status, then to a generic text', () => {
    expect(errorMessage({ status: 503 })).toBe('HTTP 503');
    expect(errorMessage({})).toBe('Unknown error');
    expect(errorMessage(null)).toBe('Unknown error');
    expect(errorMessage(undefined)).toBe('Unknown error');
  });
});

test.describe('parseJson / jsonEntries', () => {
  test('parses valid JSON and returns the fallback for missing or invalid input', () => {
    expect(parseJson('{"a":1}', {})).toEqual({ a: 1 });
    expect(parseJson('[1,2]', [])).toEqual([1, 2]);
    expect(parseJson('not json', { x: 1 })).toEqual({ x: 1 });
    expect(parseJson(null, 'fb')).toBe('fb');
    expect(parseJson('', 'fb')).toBe('fb');
  });

  test('jsonEntries turns a score breakdown into ordered key/value pairs', () => {
    expect(jsonEntries('{"disruption":0.35,"pathStretch":0,"coreTouch":0.25}')).toEqual([
      { key: 'disruption', value: 0.35 }, { key: 'pathStretch', value: 0 }, { key: 'coreTouch', value: 0.25 }
    ]);
  });

  test('jsonEntries tolerates null, arrays, primitives and broken JSON', () => {
    expect(jsonEntries(null)).toEqual([]);
    expect(jsonEntries('[1,2,3]')).toEqual([]);
    expect(jsonEntries('42')).toEqual([]);
    expect(jsonEntries('{broken')).toEqual([]);
  });
});

test.describe('basicAuthHeader', () => {
  test('encodes ASCII credentials exactly like the HTTP Basic scheme', () => {
    expect(basicAuthHeader('admin', 'admin123')).toBe('Basic YWRtaW46YWRtaW4xMjM=');
  });

  test('is UTF-8 safe (non-Latin passwords do not throw) and keeps colons in the password', () => {
    for (const [user, pass] of [['admin', 'pässwörd€'], ['operator', 'a:b:c'], ['प्रशासक', 'पासवर्ड']]) {
      const header = basicAuthHeader(user, pass);
      expect(header.startsWith('Basic ')).toBe(true);
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      expect(decoded).toBe(`${user}:${pass}`);
    }
  });
});

test.describe('needsRefresh - recommendation detail polling', () => {
  const at = '2026-09-29T10:00:00Z';

  test('first load always refreshes', () => {
    expect(needsRefresh(null, { status: 'VERIFIED', updatedAt: at })).toBe(true);
  });

  test('terminal and unchanged -> no re-render', () => {
    for (const status of ['VERIFIED', 'REJECTED', 'ROLLED_BACK', 'EXPIRED', 'NO_ACTION_RECOMMENDED', 'PENDING_APPROVAL']) {
      expect(needsRefresh({ status, updatedAt: at }, { status, updatedAt: at })).toBe(false);
    }
  });

  test('status or timestamp change -> refresh', () => {
    expect(needsRefresh({ status: 'PENDING_APPROVAL', updatedAt: at }, { status: 'EXPIRED', updatedAt: at })).toBe(true);
    expect(needsRefresh({ status: 'VERIFIED', updatedAt: at }, { status: 'VERIFIED', updatedAt: '2026-09-29T10:00:05Z' })).toBe(true);
  });

  test('live statuses keep refreshing even when unchanged', () => {
    for (const status of LIVE_RECOMMENDATION_STATUSES) {
      expect(needsRefresh({ status, updatedAt: at }, { status, updatedAt: at })).toBe(true);
    }
  });
});

test.describe('normaliseAuditFilter', () => {
  test('trims and upper-cases the type; blank means "all types"', () => {
    expect(normaliseAuditFilter(' approved ', null)).toEqual({ type: 'APPROVED', recommendationId: null });
    expect(normaliseAuditFilter('   ', null).type).toBeNull();
    expect(normaliseAuditFilter(undefined, undefined)).toEqual({ type: null, recommendationId: null });
  });

  test('accepts positive integer recommendation ids only', () => {
    expect(normaliseAuditFilter('', 42).recommendationId).toBe(42);
    expect(normaliseAuditFilter('', '17').recommendationId).toBe(17);
    for (const bad of ['', 0, -3, 1.5, 'abc', Number.NaN]) {
      expect(normaliseAuditFilter('', bad).recommendationId).toBeNull();
    }
  });
});
