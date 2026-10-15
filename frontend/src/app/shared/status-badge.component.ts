import { Component, Input } from '@angular/core';
import { statusKind } from '../core/utils';

@Component({
  selector: 'app-status',
  standalone: true,
  template: `<span class="badge" [class.ok]="kind === 'ok'" [class.warn]="kind === 'warn'"
                   [class.bad]="kind === 'bad'" [class.info]="kind === 'info'">{{ value }}</span>`
})
export class StatusBadgeComponent {
  @Input() value: string | null | undefined = '';

  get kind(): string {
    return statusKind(this.value);
  }
}
