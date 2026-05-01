import type { OpId, Operation, SiteGraph, StateId } from './types.js';

export interface PlanResult {
  ok: true;
  path: OpId[];
  total_confidence: number;
}

export interface NoPathResult {
  ok: false;
  reason: 'no-path' | 'unknown-source' | 'unknown-target';
}

interface SearchNode {
  state: StateId;
  path: OpId[];
  total_confidence: number;
  seen: Set<StateId>;
}

export function planPath(
  graph: SiteGraph,
  from: StateId,
  to: StateId,
  options?: { min_confidence?: number; max_depth?: number },
): PlanResult | NoPathResult {
  if (!graph.states[from]) return { ok: false, reason: 'unknown-source' };
  if (!graph.states[to]) return { ok: false, reason: 'unknown-target' };
  if (from === to) return { ok: true, path: [], total_confidence: 1 };

  const minConfidence = options?.min_confidence ?? 0;
  const firstPass = search(graph, from, to, minConfidence, options?.max_depth);
  if (firstPass.ok || minConfidence <= 0) return firstPass;

  return search(graph, from, to, 0, options?.max_depth);
}

function search(
  graph: SiteGraph,
  from: StateId,
  to: StateId,
  minConfidence: number,
  maxDepth = Object.keys(graph.states).length,
): PlanResult | NoPathResult {
  const edgesBySource = edgesByFromState(graph.edges, minConfidence);
  let frontier: SearchNode[] = [
    {
      state: from,
      path: [],
      total_confidence: 1,
      seen: new Set([from]),
    },
  ];

  for (let depth = 0; depth < maxDepth; depth++) {
    const found: PlanResult[] = [];
    const next: SearchNode[] = [];

    for (const node of frontier) {
      for (const edge of edgesBySource.get(node.state) ?? []) {
        if (node.seen.has(edge.to_state)) continue;

        const path = [...node.path, edge.id];
        const total_confidence = node.total_confidence * edge.confidence;

        if (edge.to_state === to) {
          found.push({ ok: true, path, total_confidence });
        } else {
          next.push({
            state: edge.to_state,
            path,
            total_confidence,
            seen: new Set([...node.seen, edge.to_state]),
          });
        }
      }
    }

    if (found.length > 0) return bestPlan(found);
    frontier = next.sort(compareSearchNodes);
    if (frontier.length === 0) break;
  }

  return { ok: false, reason: 'no-path' };
}

function edgesByFromState(edges: Operation[], minConfidence: number): Map<StateId, Operation[]> {
  const out = new Map<StateId, Operation[]>();
  const sorted = [...edges]
    .filter((edge) => edge.confidence >= minConfidence)
    .sort((a, b) => {
      if (a.from_state !== b.from_state) return a.from_state < b.from_state ? -1 : 1;
      if (a.to_state !== b.to_state) return a.to_state < b.to_state ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  for (const edge of sorted) {
    const existing = out.get(edge.from_state) ?? [];
    existing.push(edge);
    out.set(edge.from_state, existing);
  }

  return out;
}

function bestPlan(plans: PlanResult[]): PlanResult {
  return [...plans].sort(comparePlans)[0]!;
}

function comparePlans(a: PlanResult, b: PlanResult): number {
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  if (a.total_confidence !== b.total_confidence) {
    return b.total_confidence - a.total_confidence;
  }
  return a.path.join('\0') < b.path.join('\0') ? -1 : a.path.join('\0') > b.path.join('\0') ? 1 : 0;
}

function compareSearchNodes(a: SearchNode, b: SearchNode): number {
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  if (a.total_confidence !== b.total_confidence) {
    return b.total_confidence - a.total_confidence;
  }
  if (a.state !== b.state) return a.state < b.state ? -1 : 1;
  return a.path.join('\0') < b.path.join('\0') ? -1 : a.path.join('\0') > b.path.join('\0') ? 1 : 0;
}
