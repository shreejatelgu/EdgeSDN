import { expect, test } from '@playwright/test';
import type { LinkView } from '../../frontend/src/app/core/models';
import {
  COLOR_BAD, COLOR_OK, COLOR_UNKNOWN, COLOR_WARN, LAYER_Y, VIEW_WIDTH, edgeWidth, layoutTopology, utilColor
} from '../../frontend/src/app/shared/topology-layout';
import { buildTopology } from '../fixtures/mock-data';

const topology = buildTopology();

function view(id: string, utilization: number | null, predictedPeak: number | null = utilization): LinkView {
  const l = topology.links.find(x => x.id === id)!;
  return { id, a: l.a, b: l.b, capacityMbps: l.capacityMbps, utilization, mbps: utilization === null ? null : utilization * l.capacityMbps,
    predictedPeak, peakHorizon: predictedPeak === null ? null : 30, risk: null };
}

test.describe('fixture sanity - campus topology used across the suites', () => {
  test('matches the twin-agent definition: 12 switches, 15 links, 16 hosts, 6 groups', () => {
    expect(topology.switches).toHaveLength(12);
    expect(topology.links).toHaveLength(15);
    expect(topology.hosts).toHaveLength(16);
    expect(topology.groups).toHaveLength(6);
    expect(topology.groups.filter(g => g.server).map(g => g.name)).toEqual(['SERVERS']);
  });

  test('port numbers are unique per switch and link ids are "sorted-endpoints"', () => {
    const used = new Map<string, Set<number>>();
    const take = (sw: string, p: number) => {
      const s = used.get(sw) ?? new Set<number>();
      expect(s.has(p), `port ${p} reused on ${sw}`).toBe(false);
      s.add(p);
      used.set(sw, s);
    };
    for (const l of topology.links) {
      take(l.a, l.aPort);
      take(l.b, l.bPort);
      expect(l.id).toBe([l.a, l.b].sort().join('-'));
    }
    for (const h of topology.hosts) { take(h.switchName, h.port); }
  });
});

test.describe('utilColor / edgeWidth', () => {
  test('colour bands: unknown grey, <50 % green, 50-79 % amber, >=80 % red', () => {
    expect(utilColor(null)).toBe(COLOR_UNKNOWN);
    expect(utilColor(undefined)).toBe(COLOR_UNKNOWN);
    expect(utilColor(Number.NaN)).toBe(COLOR_UNKNOWN);
    expect(utilColor(0)).toBe(COLOR_OK);
    expect(utilColor(0.4999)).toBe(COLOR_OK);
    expect(utilColor(0.5)).toBe(COLOR_WARN);
    expect(utilColor(0.7999)).toBe(COLOR_WARN);
    expect(utilColor(0.8)).toBe(COLOR_BAD);
    expect(utilColor(1.3)).toBe(COLOR_BAD);
  });

  test('stroke width follows capacity with a 2 px minimum', () => {
    expect(edgeWidth(50)).toBe(6.25);
    expect(edgeWidth(20)).toBe(2.5);
    expect(edgeWidth(8)).toBe(2);
  });
});

test.describe('layoutTopology', () => {
  test('places switches in core / distribution / access layers, evenly spaced and sorted by name', () => {
    const { nodes } = layoutTopology(topology, [], null);
    expect(nodes).toHaveLength(12);
    const byRole = (role: string) => nodes.filter(n => n.role === role).sort((a, b) => a.x - b.x);
    expect(byRole('CORE').map(n => n.name)).toEqual(['c1', 'c2']);
    expect(byRole('DISTRIBUTION').map(n => n.name)).toEqual(['d1', 'd2', 'd3', 'd4']);
    expect(byRole('ACCESS').map(n => n.name)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    for (const n of nodes) {
      expect(n.y).toBe(LAYER_Y[n.role]);
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(VIEW_WIDTH);
    }
    expect(byRole('CORE').map(n => n.x)).toEqual([300, 600]);
  });

  test('access switches carry the host-group label', () => {
    const { nodes } = layoutTopology(topology, [], null);
    expect(nodes.find(n => n.name === 'a1')?.label).toBe('Examination Hall');
    expect(nodes.find(n => n.name === 'a6')?.label).toBe('Server Farm');
    expect(nodes.find(n => n.name === 'c1')?.label).toBeUndefined();
  });

  test('edges get utilisation colour, dashed outline for predicted congestion and a highlight', () => {
    const { edges } = layoutTopology(topology,
      [view('c1-d4', 0.93, 0.97), view('c1-d1', 0.62, 0.7), view('a1-d1', 0.2), view('c2-d3', null, null)], 'c1-d4');
    expect(edges).toHaveLength(15);
    const e = (id: string) => edges.find(x => x.id === id)!;
    expect(e('c1-d4')).toMatchObject({ color: COLOR_BAD, dashed: true, highlight: true });
    expect(e('c1-d1')).toMatchObject({ color: COLOR_WARN, dashed: false, highlight: false });
    expect(e('a1-d1')).toMatchObject({ color: COLOR_OK, dashed: false });
    expect(e('c2-d3')).toMatchObject({ color: COLOR_UNKNOWN, dashed: false });
    // links without telemetry at all are grey too
    expect(e('c1-c2').color).toBe(COLOR_UNKNOWN);
    expect(edges.filter(x => x.highlight).map(x => x.id)).toEqual(['c1-d4']);
  });

  test('edge endpoints are the node positions', () => {
    const { nodes, edges } = layoutTopology(topology, [], null);
    const pos = Object.fromEntries(nodes.map(n => [n.name, n]));
    for (const edge of edges) {
      const l = topology.links.find(x => x.id === edge.id)!;
      expect([edge.x1, edge.y1, edge.x2, edge.y2]).toEqual([pos[l.a].x, pos[l.a].y, pos[l.b].x, pos[l.b].y]);
    }
  });

  test('tooltip explains capacity, current and predicted load', () => {
    const { edges } = layoutTopology(topology, [view('c1-d4', 0.93, 0.97)], null);
    const title = edges.find(x => x.id === 'c1-d4')!.title;
    expect(title).toContain('capacity 30 Mbps');
    expect(title).toContain('now: 93% (27.9 Mbps)');
    expect(title).toContain('predicted peak: 97% in 30 min');
    expect(edges.find(x => x.id === 'c1-c2')!.title).toContain('now: n/a');
  });

  test('no topology -> nothing to draw; links to unknown switches are skipped', () => {
    expect(layoutTopology(null, [], null)).toEqual({ nodes: [], edges: [] });
    const broken = { ...topology, links: [...topology.links, { id: 'x9-y9', a: 'x9', aPort: 1, b: 'y9', bPort: 1, capacityMbps: 10 }] };
    expect(layoutTopology(broken, [], null).edges).toHaveLength(15);
  });
});
