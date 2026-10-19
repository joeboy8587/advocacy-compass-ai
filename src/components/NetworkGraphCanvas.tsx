import { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type ReactFlowInstance } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { Maximize, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { NetworkNode, NetworkEdge } from '@/lib/network-graph';

export default function NetworkGraphCanvas({ nodes: records, edges: connections, selected, onSelect, onEdgeSelect }: { nodes: NetworkNode[]; edges: NetworkEdge[]; selected: string | null; onSelect: (id: string) => void; onEdgeSelect: (id: string) => void }) {
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);
  const layout = useMemo(() => {
    const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    graph.setGraph({ rankdir: 'LR', nodesep: 35, ranksep: 180 });
    records.forEach(n => graph.setNode(n.id, { width: 220, height: 66 }));
    connections.forEach(e => graph.setEdge(e.source, e.target));
    dagre.layout(graph);
    return {
      nodes: records.map(n => { const p = graph.node(n.id); return { id: n.id, position: { x: p.x - 110, y: p.y - 33 }, data: { label: <div><div className="text-[9px] uppercase text-muted-foreground">{n.kind}</div><div className="text-xs break-words">{n.label}</div></div> }, className: `network-node network-node-${n.kind.toLowerCase()}`, sourcePosition: 'right', targetPosition: 'left' } as Node; }),
      edges: connections.map(e => ({ id: e.id, source: e.source, target: e.target, label: e.relation.replace(/_/g, ' ').toLowerCase(), type: 'smoothstep', className: 'network-edge' } as Edge)),
    };
  }, [records, connections]);
  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);
  useEffect(() => { setNodes(layout.nodes); setEdges(layout.edges); const timer = setTimeout(() => { void instance?.fitView({ padding: 0.15 }); }, 80); return () => clearTimeout(timer); }, [layout, instance, setNodes, setEdges]);
  const displayNodes = useMemo(() => nodes.map(n => ({ ...n, selected: n.id === selected })), [nodes, selected]);
  return <div className="network-canvas h-[580px] min-w-0 border border-border relative">
    <ReactFlow nodes={displayNodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onInit={setInstance} onNodeClick={(_, n) => onSelect(n.id)} onEdgeClick={(_, e) => onEdgeSelect(e.id)} nodesConnectable={false} edgesReconnectable={false} fitView minZoom={0.1} maxZoom={2} proOptions={{ hideAttribution: true }}>
      <Background gap={24} />
    </ReactFlow>
    <div className="absolute bottom-3 left-3 flex bg-background border border-border">
      <Button variant="ghost" size="icon" title="Zoom in" aria-label="Zoom in" onClick={() => void instance?.zoomIn()}><Plus /></Button>
      <Button variant="ghost" size="icon" title="Zoom out" aria-label="Zoom out" onClick={() => void instance?.zoomOut()}><Minus /></Button>
      <Button variant="ghost" size="icon" title="Fit network" aria-label="Fit network" onClick={() => void instance?.fitView({ padding: 0.15 })}><Maximize /></Button>
    </div>
  </div>;
}