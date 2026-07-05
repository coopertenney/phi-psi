// Pure lineage-graph helpers, derived from the roster's bigName/littleNames.
// A member's `bigName` may hold twin bigs joined with " & " (see lib/data + the
// live `lineage` view). Bigs that aren't on the roster are alumni — name-only
// nodes that anchor the top of each line.

import type { MemberRow } from './types';

export type LinNode = {
  name: string;
  member: MemberRow | null; // null = alum (name only, not on the roster)
  bigs: string[];           // parent names (0, 1, or 2 — twin bigs)
  littles: string[];        // child names, derived by inverting bigs
  depth: number;            // generation, 0 = top of the line (longest path to a root)
};

export type LinGraph = {
  nodes: Map<string, LinNode>;
  roots: string[]; // nodes with no big
};

export const splitBigs = (b: string | null | undefined): string[] =>
  b ? b.split('&').map((s) => s.trim()).filter(Boolean) : [];

export function buildLineageGraph(members: MemberRow[]): LinGraph {
  const byName = new Map(members.map((m) => [m.fullName, m]));
  const nodes = new Map<string, LinNode>();
  const ensure = (name: string): LinNode => {
    let n = nodes.get(name);
    if (!n) { n = { name, member: byName.get(name) ?? null, bigs: [], littles: [], depth: 0 }; nodes.set(name, n); }
    return n;
  };
  for (const m of members) {
    const node = ensure(m.fullName);
    node.bigs = splitBigs(m.bigName);
    for (const b of node.bigs) {
      const bn = ensure(b);
      if (!bn.littles.includes(m.fullName)) bn.littles.push(m.fullName);
    }
  }
  // depth = longest path up to a root, so a node always sits below every big.
  const memo = new Map<string, number>();
  const depthOf = (name: string, seen: Set<string>): number => {
    const cached = memo.get(name);
    if (cached !== undefined) return cached;
    const n = nodes.get(name)!;
    if (!n.bigs.length || seen.has(name)) { memo.set(name, 0); return 0; }
    seen.add(name);
    const d = 1 + Math.max(...n.bigs.map((b) => depthOf(b, seen)));
    seen.delete(name);
    memo.set(name, d);
    return d;
  };
  for (const n of nodes.values()) n.depth = depthOf(n.name, new Set());
  for (const n of nodes.values()) n.littles.sort();
  const roots = [...nodes.values()].filter((n) => n.bigs.length === 0).map((n) => n.name).sort();
  return { nodes, roots };
}

// Names in one member's line: all ancestors (bigs, up to the root) + the member
// + descendants down `down` generations. Used for the focused profile tree.
export function lineageAround(graph: LinGraph, focus: string, down = 2): Set<string> {
  const keep = new Set<string>();
  const up = (name: string) => {
    if (keep.has(name)) return;
    keep.add(name);
    (graph.nodes.get(name)?.bigs ?? []).forEach(up);
  };
  const downFrom = (name: string, d: number) => {
    keep.add(name);
    if (d <= 0) return;
    (graph.nodes.get(name)?.littles ?? []).forEach((c) => downFrom(c, d - 1));
  };
  if (!graph.nodes.has(focus)) return keep;
  up(focus);
  downFrom(focus, down);
  return keep;
}

// Chain to highlight when a node is selected: all ancestors + all descendants.
export function connectedLine(graph: LinGraph, name: string): Set<string> {
  const s = new Set<string>();
  const up = (n: string) => { if (s.has(n)) return; s.add(n); (graph.nodes.get(n)?.bigs ?? []).forEach(up); };
  const down = (n: string) => { (graph.nodes.get(n)?.littles ?? []).forEach((c) => { if (!s.has(c)) { s.add(c); down(c); } }); };
  up(name); down(name);
  return s;
}
