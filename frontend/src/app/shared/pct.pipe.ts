import { Pipe, PipeTransform } from '@angular/core';
import { formatNum, formatPct } from '../core/utils';

/** 0.734 -> "73%". null/undefined -> "—". */
@Pipe({ name: 'pct', standalone: true })
export class PctPipe implements PipeTransform {
  transform(v: number | null | undefined, digits = 0): string {
    return formatPct(v, digits);
  }
}

/** Number with fixed decimals; null -> "—". */
@Pipe({ name: 'num', standalone: true })
export class NumPipe implements PipeTransform {
  transform(v: number | null | undefined, digits = 2): string {
    return formatNum(v, digits);
  }
}
