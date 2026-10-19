import { describe, expect, it } from 'bun:test';
import { filterNetwork, type StoredNetwork } from './network-graph';

const graph: StoredNetwork = {
  nodes: ['N786FA', 'ALF IX LLC', 'Other'].map(id => ({ id, label: id, kind: 'AIRCRAFT', metadata: {}, recordedAt: null })),
  edges: [{ id: 'one', source: 'N786FA', target: 'ALF IX LLC', relation: 'OWNED_BY', weight: 1, metadata: {}, recordedAt: null }],
  truncated: false,
};
describe('stored network filtering', () => {
  it('includes the recorded neighbor when searching an aircraft case-insensitively', () => {
    const result = filterNetwork(graph, 'n786fa', '');
    expect(result.nodes.map(n => n.id)).toEqual(['N786FA', 'ALF IX LLC']);
    expect(result.edges).toHaveLength(1);
  });
  it('does not invent relationships for an unmatched filter', () => {
    expect(filterNetwork(graph, '', 'CO_OWNED_BY')).toEqual({ nodes: [], edges: [] });
  });
});