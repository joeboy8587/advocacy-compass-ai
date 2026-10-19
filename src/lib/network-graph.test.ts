import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { filterNetwork, type StoredNetwork } from './network-graph';

const graph: StoredNetwork = {
  nodes: ['N786FA', 'ALF IX LLC', 'Other'].map(id => ({ id, label: id, kind: 'AIRCRAFT', metadata: {}, recordedAt: null })),
  edges: [{ id: 'one', source: 'N786FA', target: 'ALF IX LLC', relation: 'OWNED_BY', weight: 1, metadata: {}, recordedAt: null }],
  truncated: false,
};
describe('stored network filtering', () => {
  it('includes the recorded neighbor when searching an aircraft case-insensitively', () => {
    const result = filterNetwork(graph, 'n786fa', '');
    assert.deepEqual(result.nodes.map(n => n.id), ['N786FA', 'ALF IX LLC']);
    assert.equal(result.edges.length, 1);
  });
  it('does not invent relationships for an unmatched filter', () => {
    assert.deepEqual(filterNetwork(graph, '', 'CO_OWNED_BY'), { nodes: [], edges: [] });
  });
});