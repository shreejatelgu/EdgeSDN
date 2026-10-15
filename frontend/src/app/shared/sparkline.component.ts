import { Component, Input, OnChanges } from '@angular/core';
import { sparklineGeometry } from './sparkline-geometry';

/** Minimal SVG line chart for a 0..max series (no external chart library). */
@Component({
  selector: 'app-sparkline',
  standalone: true,
  template: `
    <svg [attr.viewBox]="'0 0 ' + width + ' ' + height" [attr.width]="'100%'" [attr.height]="height"
         preserveAspectRatio="none" role="img" [attr.aria-label]="label">
      <line [attr.x1]="0" [attr.x2]="width" [attr.y1]="thresholdY" [attr.y2]="thresholdY"
            stroke="#c0392b" stroke-dasharray="4 3" stroke-width="1" />
      <polyline [attr.points]="points" fill="none" stroke="#1f6feb" stroke-width="2" />
    </svg>
    <div class="row small muted"><span>{{ label }}</span><span class="spacer"></span>
      <span>max {{ maxLabel }}</span></div>`
})
export class SparklineComponent implements OnChanges {
  @Input() values: number[] = [];
  @Input() max = 1;
  @Input() threshold = 0.8;
  @Input() label = '';
  @Input() width = 400;
  @Input() height = 80;
  points = '';
  thresholdY = 0;
  maxLabel = '—';

  ngOnChanges(): void {
    const g = sparklineGeometry(this.values, this.max, this.threshold, this.width, this.height);
    this.points = g.points;
    this.thresholdY = g.thresholdY;
    this.maxLabel = g.maxLabel;
  }
}
