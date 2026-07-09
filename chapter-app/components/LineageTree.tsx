'use client';

import { useMemo, useRef, useState } from 'react';
import type { MemberRow } from '@/lib/types';
import { buildLineageGraph, lineageAround, connectedLine, type LinGraph } from '@/lib/lineage';

// Generation palette (top → bottom), bright enough to carry dark labels in both
// themes — the same banding as the standalone lineage diagram.
const BAND = ['#8A7DF0', '#77B6F5', '#77E6D2', '#A9E67F', '#F0E67C', '#F2C77E', '#EE8585', '#F084CE'];

const R = 22, DX = 66, ROWH = 116, PADX = 40, PADY = 40;
const MIN_ZOOM = 0.2, MAX_ZOOM = 2, ZOOM_STEP = 0.15;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

type Placed = { name: string; x: number; y: number; depth: number; member: MemberRow | null };
type Edge = { big: string; little: string };

function layout(graph: LinGraph, subset: Set<string> | null) {
  const inSet = (n: string) => (subset ? subset.has(n) : true);
  const nodes = [...graph.nodes.values()].filter((n) => inSet(n.name));
  const minDepth = nodes.length ? Math.min(...nodes.map((n) => n.depth)) : 0;

  // layout-parent = first big that's in the subset (single-parent tree for x);
  // all bigs still get an edge so twin bigs show both lines.
  const layoutParent = new Map<string, string | null>();
  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    const p = n.bigs.find((b) => inSet(b)) ?? null;
    layoutParent.set(n.name, p);
    if (p) (childrenOf.get(p) ?? childrenOf.set(p, []).get(p)!).push(n.name);
  }
  for (const arr of childrenOf.values()) arr.sort();

  // Root ordering: alphabetical, but keep root-trees joined by a twin-big cross
  // edge adjacent, so co-parents (e.g. Aaron Tiao & Arjin Claire — both bigs of
  // Shawn Gregory) sit next to each other instead of at opposite ends of the
  // forest. Only twin bigs create long crossing edges here; a single-parent tree
  // with sorted children never crosses.
  const rawRoots = nodes.filter((n) => !layoutParent.get(n.name)).map((n) => n.name);
  const rootOf = (name: string): string => {
    let n = name, p = layoutParent.get(n);
    while (p) { n = p; p = layoutParent.get(n); }
    return n;
  };
  const uf = new Map<string, string>(rawRoots.map((r) => [r, r]));
  const find = (x: string): string => { while (uf.get(x) !== x) { uf.set(x, uf.get(uf.get(x)!)!); x = uf.get(x)!; } return x; };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) uf.set(ra, rb); };
  for (const n of nodes) {
    const lp = layoutParent.get(n.name);
    for (const b of n.bigs) {
      if (!inSet(b) || b === lp) continue; // the non-layout big → couple the two lines it spans
      const rb = rootOf(b), rn = rootOf(n.name);
      if (uf.has(rb) && uf.has(rn)) union(rb, rn);
    }
  }
  const clusters = new Map<string, string[]>();
  for (const r of rawRoots) { const c = find(r); (clusters.get(c) ?? clusters.set(c, []).get(c)!).push(r); }
  const roots = [...clusters.values()]
    .map((arr) => arr.sort())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .flat();

  const pos = new Map<string, Placed>();
  let cur = 0;
  const place = (name: string) => {
    const node = graph.nodes.get(name)!;
    const kids = childrenOf.get(name) ?? [];
    const y = (node.depth - minDepth) * ROWH + PADY;
    if (!kids.length) { pos.set(name, { name, x: cur * DX + PADX, y, depth: node.depth, member: node.member }); cur++; return; }
    kids.forEach(place);
    const xs = kids.map((k) => pos.get(k)!.x);
    pos.set(name, { name, x: (Math.min(...xs) + Math.max(...xs)) / 2, y, depth: node.depth, member: node.member });
  };
  roots.forEach((r) => { place(r); cur++; });

  const edges: Edge[] = [];
  for (const n of nodes) for (const b of n.bigs) if (inSet(b)) edges.push({ big: b, little: n.name });

  const maxDepth = nodes.length ? Math.max(...nodes.map((n) => n.depth)) : 0;
  const W = cur * DX + PADX;
  const H = (maxDepth - minDepth) * ROWH + PADY * 2;
  return { pos, edges, W, H, minDepth };
}

const twoLines = (name: string): [string, string] => {
  const w = name.split(' ');
  if (w.length <= 1) return [name.length > 12 ? name.slice(0, 11) + '…' : name, ''];
  const first = w[0], rest = w.slice(1).join(' ');
  const cut = (s: string) => (s.length > 12 ? s.slice(0, 11) + '…' : s);
  return [cut(first), cut(rest)];
};

export function LineageTree({
  members, focusName, interactive: interactiveProp, height,
}: {
  members: MemberRow[];
  focusName?: string;
  interactive?: boolean;
  height?: number;
}) {
  const interactive = interactiveProp ?? !focusName;
  const graph = useMemo(() => buildLineageGraph(members), [members]);
  const subset = useMemo(
    () => (focusName ? lineageAround(graph, focusName, 2) : null),
    [graph, focusName],
  );
  const { pos, edges, W, H } = useMemo(() => layout(graph, subset), [graph, subset]);

  const [picked, setPicked] = useState<string | null>(focusName ?? null);
  const [zoom, setZoom] = useState(1);
  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const chain = useMemo(() => (picked ? connectedLine(graph, picked) : null), [graph, picked]);
  const dim = (name: string) => (chain && !chain.has(name) ? 0.14 : 1);

  const focusNode = (name: string) => {
    const p = pos.get(name); const sc = scrollRef.current;
    if (!p || !sc) return;
    sc.scrollTo({ left: p.x * zoom - sc.clientWidth / 2, top: p.y * zoom - sc.clientHeight / 2, behavior: 'smooth' });
  };
  // Fit the whole forest across the viewport width so the entire tree is visible
  // at once (depth scrolls vertically). Answers "I should see the entire tree".
  const fitToView = () => {
    const sc = scrollRef.current;
    if (!sc) return;
    setZoom(clampZoom((sc.clientWidth - 8) / W));
    sc.scrollTo({ left: 0, top: 0 });
  };
  const onSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !query.trim()) return;
    const q = query.toLowerCase().trim();
    const hit = [...pos.keys()].find((n) => n.toLowerCase().includes(q));
    if (hit) { setPicked(hit); focusNode(hit); }
  };

  const nodeEls = [...pos.values()].map((p) => {
    const col = BAND[((p.depth % BAND.length) + BAND.length) % BAND.length];
    // "Current brother" = an active/new member row. Alumni are faded — whether
    // they're name-only anchors (p.member null) or inactive membership rows that
    // exist only to carry their lineage history. Keying on status (not just row
    // presence) keeps every alum styled the same, per the page legend.
    const isCurrent = !!p.member && p.member.status !== 'inactive';
    const isFocus = p.name === focusName;
    const traced = !!chain && chain.has(p.name);
    const [l1, l2] = twoLines(p.name);
    return (
      <g key={p.name} transform={`translate(${p.x},${p.y})`}
         style={{ cursor: interactive ? 'pointer' : 'default', opacity: dim(p.name), transition: 'opacity .15s' }}
         onClick={interactive ? (e) => { e.stopPropagation(); setPicked((cur) => (cur === p.name ? null : p.name)); } : undefined}>
        <circle r={R} fill={col} opacity={isCurrent ? 1 : 0.4}
                stroke={isFocus ? 'var(--pkp-primary-strong, #7a1420)' : traced ? 'var(--pkp-primary, #8c1d2c)' : isCurrent ? '#241f18' : 'none'}
                strokeWidth={isFocus ? 3.5 : traced ? 3 : isCurrent ? 1.4 : 0} />
        <text textAnchor="middle" fill="#241f18" fontSize={8.4} fontWeight={isCurrent ? 700 : 500}
              style={{ pointerEvents: 'none', userSelect: 'none' }}>
          <tspan x={0} y={l2 ? -1.5 : 2}>{l1}</tspan>
          {l2 && <tspan x={0} y={8}>{l2}</tspan>}
        </text>
      </g>
    );
  });

  const edgeEls = edges.map(({ big, little }) => {
    const a = pos.get(big), b = pos.get(little);
    if (!a || !b) return null;
    const traced = !!chain && chain.has(big) && chain.has(little);
    const d = `M${a.x},${a.y + R} C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y - R}`;
    return <path key={`${big}->${little}`} d={d} fill="none" strokeLinecap="round"
                 stroke={traced ? 'var(--pkp-primary, #8c1d2c)' : 'var(--cream-400, #d9cfb8)'}
                 strokeWidth={traced ? 3 : 1.5}
                 style={{ opacity: chain ? (traced ? 1 : 0.08) : 0.9, transition: 'opacity .15s' }} />;
  });

  const svgW = W * zoom, svgH = H * zoom;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: interactive ? 12 : 0 }}>
      {interactive && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearch}
                 placeholder="Find a brother…" aria-label="find"
                 style={{ fontSize: 13, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--cream-400)', background: 'var(--white)', color: 'var(--ink-800)', minWidth: 200 }} />
          {/* Zoom cluster — labeled + tooltipped so it's obvious what the buttons do */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--cream-400)', borderRadius: 8, background: 'var(--white)', padding: '2px 6px 2px 10px' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-600)' }}>Zoom</span>
            <button title="Zoom out" aria-label="Zoom out" onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
                    style={{ width: 28, height: 28, border: 'none', background: 'transparent', color: 'var(--ink-700)', cursor: 'pointer', fontSize: 20, lineHeight: 1, borderRadius: 6 }}>－</button>
            <span style={{ fontSize: 12, color: 'var(--ink-500)', minWidth: 38, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{Math.round(zoom * 100)}%</span>
            <button title="Zoom in" aria-label="Zoom in" onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
                    style={{ width: 28, height: 28, border: 'none', background: 'transparent', color: 'var(--ink-700)', cursor: 'pointer', fontSize: 18, lineHeight: 1, borderRadius: 6 }}>＋</button>
          </div>
          <button className="pkp-btn-ghost" title="Fit the entire tree in view" style={{ height: 34, padding: '0 14px', fontSize: 13 }} onClick={fitToView}>Fit tree</button>
          {picked && <button className="pkp-btn-ghost" style={{ height: 34, padding: '0 12px', fontSize: 13 }} onClick={() => setPicked(null)}>Clear</button>}
          <span style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>
            {picked ? `Tracing ${picked}` : 'Click a brother to trace his line'}
          </span>
        </div>
      )}
      <div ref={scrollRef}
           onClick={interactive ? () => setPicked(null) : undefined}
           style={{ overflow: 'auto', maxHeight: height ?? (interactive ? '72vh' : 320), border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-md)', background: 'var(--cream-50)' }}>
        <svg width={svgW} height={svgH} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
          {edgeEls}
          {nodeEls}
        </svg>
      </div>
    </div>
  );
}
