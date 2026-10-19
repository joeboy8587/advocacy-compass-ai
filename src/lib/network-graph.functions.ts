import { createServerFn } from '@tanstack/react-start';
import type { StoredNetwork } from './network-graph';

export const getStoredNetwork = createServerFn({ method: 'GET' }).handler(async (): Promise<StoredNetwork> => {
  const { neonQuery, neonUserError } = await import('./reference-neon.server');
  try {
    const { results } = await neonQuery<{ results: { rows: Record<string, unknown>[] }[] }>([
      { query: 'select node_id, node_type, display_name, metadata, to_json(created_at) as recorded_at from public.shell_network_nodes order by node_type, node_id limit 501' },
      { query: 'select source_node, target_node, edge_type, weight, metadata, to_json(created_at) as recorded_at from public.shell_network_edges order by source_node,target_node,edge_type limit 1001' },
    ], [], { 'Neon-Batch-Read-Only': 'true' });
    const nodeRows = results[0]?.rows ?? [];
    const edgeRows = results[1]?.rows ?? [];
    const metadata = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const nodes = nodeRows.slice(0, 500).map(r => ({ id: String(r.node_id), label: String(r.display_name), kind: String(r.node_type), metadata: metadata(r.metadata), recordedAt: r.recorded_at ? String(r.recorded_at) : null }));
    const ids = new Set(nodes.map(n => n.id));
    const edges = edgeRows.slice(0, 1000).filter(r => ids.has(String(r.source_node)) && ids.has(String(r.target_node))).map((r, i) => ({ id: `edge-${i}`, source: String(r.source_node), target: String(r.target_node), relation: String(r.edge_type), weight: r.weight == null ? null : Number(r.weight), metadata: metadata(r.metadata), recordedAt: r.recorded_at ? String(r.recorded_at) : null }));
    return { nodes, edges, truncated: nodeRows.length > 500 || edgeRows.length > 1000 };
  } catch (error) {
    console.error(error);
    throw new Error(neonUserError(error).message);
  }
});