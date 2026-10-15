import { Component, Input, OnChanges } from '@angular/core';
import { LinkView, Topology } from '../core/models';
import { Edge, NodePos, layoutTopology } from './topology-layout';

/** SVG campus topology; link colour = current utilisation, dashed outline = predicted congestion. */
@Component({
  selector: 'app-topology-view',
  standalone: true,
  template: `
    @if (!topology) {
      <p class="muted">Topology not loaded.</p>
    } @else {
      <svg viewBox="0 0 900 400" width="100%" role="img" aria-label="Campus SDN topology">
        @for (e of edges; track e.id) {
          @if (e.highlight) {
            <line [attr.x1]="e.x1" [attr.y1]="e.y1" [attr.x2]="e.x2" [attr.y2]="e.y2"
                  stroke="#ffd33d" [attr.stroke-width]="e.width + 8" stroke-linecap="round" />
          }
          <line [attr.x1]="e.x1" [attr.y1]="e.y1" [attr.x2]="e.x2" [attr.y2]="e.y2"
                [attr.stroke]="e.color" [attr.stroke-width]="e.width" stroke-linecap="round"
                [attr.stroke-dasharray]="e.dashed ? '8 5' : null">
            <title>{{ e.title }}</title>
          </line>
        }
        @for (n of nodes; track n.name) {
          <g [attr.transform]="'translate(' + n.x + ',' + n.y + ')'">
            <rect x="-22" y="-14" width="44" height="28" rx="6"
                  [attr.fill]="n.role === 'CORE' ? '#16202c' : n.role === 'DISTRIBUTION' ? '#3b4a5c' : '#6b7c90'" />
            <text text-anchor="middle" dy="5" fill="#fff" font-size="13" font-weight="600">{{ n.name }}</text>
            @if (n.label) {
              <text text-anchor="middle" y="34" font-size="11" fill="#5d6b7c">{{ n.label }}</text>
            }
          </g>
        }
      </svg>
      <div class="row small muted">
        <span><span class="badge ok">&lt;50%</span></span>
        <span><span class="badge warn">50-80%</span></span>
        <span><span class="badge bad">&ge;80%</span></span>
        <span>dashed = predicted &ge; 80% within the forecast horizon</span>
      </div>
    }`
})
export class TopologyViewComponent implements OnChanges {
  @Input() topology: Topology | null = null;
  @Input() links: LinkView[] = [];
  @Input() highlightLink: string | null = null;
  nodes: NodePos[] = [];
  edges: Edge[] = [];

  ngOnChanges(): void {
    const { nodes, edges } = layoutTopology(this.topology, this.links, this.highlightLink);
    this.nodes = nodes;
    this.edges = edges;
  }
}
