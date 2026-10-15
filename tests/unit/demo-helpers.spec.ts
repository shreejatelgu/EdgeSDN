import { expect, test } from '@playwright/test';
import {
  DEFAULT_CLASS_DEMAND, EXAM_SURGE_PRESET, defaultScenarioLink, positiveDemands, presetDemands, scenarioRequest
} from '../../frontend/src/app/core/demo-helpers';
import { buildTopology } from '../fixtures/mock-data';

const CLASSES = ['EXAM_HALL', 'LAB', 'HOSTEL', 'ADMIN', 'LIBRARY'];

test.describe('presetDemands - exam-surge demo load', () => {
  test('fills the documented preset for every client group', () => {
    expect(presetDemands(CLASSES)).toEqual({ EXAM_HALL: 12, LAB: 6, HOSTEL: 10, ADMIN: 2, LIBRARY: 3 });
  });

  test('the preset overloads the 30 Mbps bottleneck c1-d4 (all classes cross it)', () => {
    const c1d4 = buildTopology().links.find(l => l.id === 'c1-d4')!;
    const total = Object.values(presetDemands(CLASSES)).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(c1d4.capacityMbps);
  });

  test('unknown groups get the default demand', () => {
    expect(presetDemands(['EXAM_HALL', 'NEW_BLOCK'])).toEqual({ EXAM_HALL: 12, NEW_BLOCK: DEFAULT_CLASS_DEMAND });
  });

  test('the preset constant is read-only data (a copy is returned)', () => {
    const d = presetDemands(CLASSES);
    d.EXAM_HALL = 99;
    expect(EXAM_SURGE_PRESET.EXAM_HALL).toBe(12);
  });
});

test.describe('positiveDemands - body of POST /api/scenarios/live-traffic', () => {
  test('keeps only finite demands > 0 and coerces strings', () => {
    const d = positiveDemands(CLASSES, { EXAM_HALL: '12', LAB: 0, HOSTEL: -1, ADMIN: '', LIBRARY: 'abc' });
    expect(d).toEqual({ EXAM_HALL: 12 });
  });

  test('ignores keys that are not traffic classes', () => {
    expect(positiveDemands(['LAB'], { LAB: 3, SERVERS: 50 })).toEqual({ LAB: 3 });
  });

  test('all-zero input yields an empty map (the page then refuses to send it)', () => {
    expect(positiveDemands(CLASSES, { EXAM_HALL: 0, LAB: 0 })).toEqual({});
  });
});

test.describe('scenarioRequest - body of POST /api/scenarios', () => {
  const base = { linkId: 'c1-d4', predictedUtilization: '0.95', confidence: '0.85', durationMinutes: '30', note: 'demo' };

  test('blank or null horizon means "all horizons" (null)', () => {
    expect(scenarioRequest({ ...base, horizonMinutes: '' }).horizonMinutes).toBeNull();
    expect(scenarioRequest({ ...base, horizonMinutes: null }).horizonMinutes).toBeNull();
    expect(scenarioRequest({ ...base, horizonMinutes: undefined }).horizonMinutes).toBeNull();
    expect(scenarioRequest({ ...base, horizonMinutes: 'x' }).horizonMinutes).toBeNull();
  });

  test('coerces all numeric fields', () => {
    expect(scenarioRequest({ ...base, horizonMinutes: '30' })).toEqual({
      linkId: 'c1-d4', horizonMinutes: 30, predictedUtilization: 0.95, confidence: 0.85, durationMinutes: 30, note: 'demo'
    });
  });
});

test.describe('defaultScenarioLink', () => {
  test('prefers the designed bottleneck c1-d4, else the first link, else empty', () => {
    expect(defaultScenarioLink(['a1-d1', 'c1-d4'])).toBe('c1-d4');
    expect(defaultScenarioLink(['a1-d1', 'a2-d1'])).toBe('a1-d1');
    expect(defaultScenarioLink([])).toBe('');
  });
});
