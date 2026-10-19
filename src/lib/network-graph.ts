export type NetworkNode = { id: string; label: string; kind: string; metadata: Record<string, unknown>; recordedAt: string | null };
export type NetworkEdge = { id: string; source: string; target: string; relation: string; weight: number | null; metadata: Record<string, unknown>; recordedAt: string | null };
export type StoredNetwork = { nodes: NetworkNode[]; edges: NetworkEdge[]; truncated: boolean };

export function filterNetwork(graph: StoredNetwork, search: string, relation: string) {
  const edges = graph.edges.filter(e => !relation || e.relation === relation);
  const term = search.trim().toLowerCase();
  const matches = new Set(graph.nodes.filter(n => !term || n.label.toLowerCase().includes(term)).map(n => n.id));
  const visibleEdges = edges.filter(e => !term || matches.has(e.source) || matches.has(e.target));
  const visible = new Set([...matches, ...visibleEdges.flatMap(e => [e.source, e.target])]);
  if (relation) {
    const connected = new Set(visibleEdges.flatMap(e => [e.source, e.target]));
    return { nodes: graph.nodes.filter(n => connected.has(n.id)), edges: visibleEdges };
  }
  return { nodes: graph.nodes.filter(n => visible.has(n.id)), edges: visibleEdges };
}