import { expect, test } from '@playwright/test';
import { sparklineGeometry } from '../../frontend/src/app/shared/sparkline-geometry';

test.describe('sparklineGeometry - telemetry history chart', () => {
  test('maps values onto the SVG box (y grows downwards)', () => {
    const g = sparklineGeometry([0, 0.5, 1], 1, 0.8, 100, 50);
    expect(g.points).toBe('0,50 50,25 100,0');
    expect(g.maxLabel).toBe('100%');
  });

  test('draws the congestion threshold line at the right height', () => {
    expect(sparklineGeometry([0.1, 0.2], 1, 0.8, 400, 80).thresholdY).toBe(16);
  });

  test('rescales when a value exceeds the nominal maximum (overload stays visible)', () => {
    const g = sparklineGeometry([0.5, 2], 1, 0.8, 100, 100);
    expect(g.points).toBe('0,75 100,0');
    expect(g.thresholdY).toBe(60);
    expect(g.maxLabel).toBe('200%');
  });

  test('clamps negative values to the baseline and ignores non-finite samples', () => {
    const g = sparklineGeometry([-0.2, Number.NaN, 1, Number.POSITIVE_INFINITY], 1, 0.8, 10, 10);
    expect(g.points).toBe('0,10 10,0');
  });

  test('fewer than two samples: no line, but still a label', () => {
    expect(sparklineGeometry([], 1, 0.8, 100, 50)).toEqual({ points: '', thresholdY: 10, maxLabel: '—' });
    expect(sparklineGeometry([0.42], 1, 0.8, 100, 50)).toEqual({ points: '', thresholdY: 10, maxLabel: '42%' });
  });

  test('coordinates are rounded to two decimals (stable SVG output)', () => {
    const g = sparklineGeometry([0.1, 0.2, 0.3], 1, 0.8, 100, 30);
    for (const pair of g.points.split(' ')) {
      for (const n of pair.split(',')) {
        expect(n).toMatch(/^-?\d+(\.\d{1,2})?$/);
      }
    }
  });
});
