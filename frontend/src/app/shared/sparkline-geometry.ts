// Framework-free geometry of the sparkline chart (unit-tested).

export interface SparklineGeometry {
  /** SVG polyline "x,y x,y ..." (empty when fewer than 2 values). */
  points: string;
  /** y coordinate of the dashed threshold line. */
  thresholdY: number;
  /** Largest value as a percentage label, or "—". */
  maxLabel: string;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The vertical scale is max(max, largest value); negative values sit on the baseline; non-finite values are ignored. */
export function sparklineGeometry(values: number[], max: number, threshold: number, width: number, height: number):
  SparklineGeometry {
  const clean = (values ?? []).filter(v => Number.isFinite(v));
  const n = clean.length;
  const top = Math.max(max, ...clean, 0.0001);
  const thresholdY = round2(height - (threshold / top) * height);
  const maxLabel = n ? `${(Math.max(...clean) * 100).toFixed(0)}%` : '—';
  if (n < 2) { return { points: '', thresholdY, maxLabel }; }
  const points = clean
    .map((v, i) => `${round2((i / (n - 1)) * width)},${round2(height - (Math.max(0, v) / top) * height)}`)
    .join(' ');
  return { points, thresholdY, maxLabel };
}
