// Framework-free layout of the campus topology SVG (unit-tested).
import type { LinkView, Topology } from '../core/models';

export interface NodePos { name: string; role: string; x: number; y: number; label?: string; }
export interface Edge {
  id: string; x1: number; y1: number; x2: number; y2: number; color: string; width: number;
  dashed: boolean; title: string; highlight: boolean;
}

export const VIEW_WIDTH = 900;
export const LAYER_Y: Readonly<Record<string, number>> = { CORE: 60, DISTRIBUTION: 190, ACCESS: 320 };
export const COLOR_UNKNOWN = '#b8c2cc';
export const COLOR_OK = '#2ea043';
export const COLOR_WARN = '#d4a017';
export const COLOR_BAD = '#c0392b';
export const CONGESTION = 0.8;

export function utilColor(u: number | null | undefined): string {
  if (u === null || u === undefined || Number.isNaN(u)) { return COLOR_UNKNOWN; }
  if (u >= CONGESTION) { return COLOR_BAD; }
  if (u >= 0.5) { return COLOR_WARN; }
  return COLOR_OK;
}

export function edgeWidth(capacityMbps: number): number {
  return Math.max(2, capacityMbps / 8);
}

/** Switches in three layers (sorted by name, evenly spaced); edges coloured by current utilisation. */
export function layoutTopology(topology: Topology | null, links: LinkView[] | null | undefined,
                               highlightLink: string | null): { nodes: NodePos[]; edges: Edge[] } {
  if (!topology) { return { nodes: [], edges: [] }; }
  const byRole: Record<string, string[]> = {};
  for (const s of topology.switches) { (byRole[s.role] ??= []).push(s.name); }
  const labelOf: Record<string, string> = {};
  for (const g of topology.groups) { labelOf[g.accessSwitch] = g.label; }

  const pos: Record<string, NodePos> = {};
  for (const role of Object.keys(byRole)) {
    const names = [...byRole[role]].sort();
    names.forEach((name, i) => {
      pos[name] = { name, role, x: ((i + 1) * VIEW_WIDTH) / (names.length + 1), y: LAYER_Y[role] ?? LAYER_Y['ACCESS'], label: labelOf[name] };
    });
  }

  const view: Record<string, LinkView> = {};
  for (const l of links ?? []) { view[l.id] = l; }
  const edges = topology.links.filter(l => pos[l.a] && pos[l.b]).map(l => {
    const v = view[l.id];
    const u = v?.utilization ?? null;
    const p = v?.predictedPeak ?? null;
    return {
      id: l.id,
      x1: pos[l.a].x, y1: pos[l.a].y, x2: pos[l.b].x, y2: pos[l.b].y,
      color: utilColor(u),
      width: edgeWidth(l.capacityMbps),
      dashed: p !== null && p >= CONGESTION,
      highlight: highlightLink === l.id,
      title: `${l.id}  capacity ${l.capacityMbps} Mbps\nnow: ${u === null ? 'n/a' : (u * 100).toFixed(0) + '%'}`
        + (v?.mbps != null ? ` (${v.mbps.toFixed(1)} Mbps)` : '')
        + `\npredicted peak: ${p === null ? 'n/a' : (p * 100).toFixed(0) + '% in ' + v?.peakHorizon + ' min'}`
    };
  });
  return { nodes: Object.values(pos), edges };
}
