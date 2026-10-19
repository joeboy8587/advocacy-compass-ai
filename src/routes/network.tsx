import { createFileRoute, ClientOnly, Link } from '@tanstack/react-router';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Network, Loader2, Download, Search, X } from 'lucide-react';
import { getStoredNetwork } from '@/lib/network-graph.functions';
import { filterNetwork } from '@/lib/network-graph';
import { Button } from '@/components/ui/button';
import { LoadErrorPanel } from '@/components/LoadErrorPanel';

const Canvas = lazy(() => import('@/components/NetworkGraphCanvas'));
const options = queryOptions({ queryKey: ['stored-network'], queryFn: () => getStoredNetwork(), staleTime: 600_000, retry: false });
const Loading = () => <div className="h-[580px] flex items-center justify-center text-muted-foreground gap-2"><Loader2 className="size-4 animate-spin" /> Loading network…</div>;
export const Route = createFileRoute('/network')({
  head: () => ({ meta: [{ title: 'Network Graph // Watchtower' }, { name: 'description', content: 'Explore recorded aircraft and company connections with relationship details and source dates.' }, { property: 'og:title', content: 'Network Graph // Watchtower' }, { property: 'og:description', content: 'Watchtower recorded aircraft and company relationship graph.' }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(options),
  pendingComponent: Loading,
  errorComponent: ({ error, reset }) => <LoadErrorPanel error={error} reset={reset} title="The network didn't load" />,
  component: NetworkPage,
});

function NetworkPage() {
  const { data } = useSuspenseQuery(options);
  const [search, setSearch] = useState('');
  const [relation, setRelation] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const graph = useMemo(() => filterNetwork(data, search, relation), [data, search, relation]);
  const node = data.nodes.find(n => n.id === selected);
  const edge = data.edges.find(e => e.id === edgeId);
  const related = node ? data.edges.filter(e => e.source === node.id || e.target === node.id) : [];
  const latest = data.edges.map(e => e.recordedAt).filter((d): d is string => Boolean(d)).sort().at(-1);
  const label = (id: string) => data.nodes.find(n => n.id === id)?.label ?? `Unresolved entry (${id})`;
  const pickNode = (id: string) => { setSelected(id); setEdgeId(null); };
  const exportGraph = () => { const blob = new Blob([JSON.stringify({ source: 'shell_network_nodes / shell_network_edges', ...graph }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'watchtower-network.json'; a.click(); URL.revokeObjectURL(url); };
  return <div className="p-4 md:p-6 space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl text-primary flex items-center gap-2"><Network /> Network Graph</h1><p className="text-xs text-muted-foreground mt-2">{data.nodes.length} recorded entries · {data.edges.length} connections · Last recorded {latest ? new Date(latest).toLocaleDateString() : 'unknown'}</p></div>
      <Button variant="outline" size="sm" onClick={exportGraph}><Download /> Export</Button>
    </header>
    <p className="text-xs text-muted-foreground border-l-2 border-primary pl-3">Stored network records, not a live FAA ownership check. A connection does not establish surveillance or wrongdoing; ownership and airframe neither clear nor condemn an aircraft.</p>
    {data.truncated && <p className="text-xs text-primary">Display limited to 500 entries and 1,000 connections.</p>}
    <div className="flex flex-wrap gap-3 items-center">
      <label className="flex items-center gap-2 border border-border bg-input px-3 py-2 flex-1 min-w-48"><Search className="size-4 text-muted-foreground" /><input aria-label="Search network" value={search} onChange={e => { setSearch(e.target.value); setSelected(null); setEdgeId(null); }} placeholder="Aircraft or company…" className="bg-transparent outline-none text-xs w-full" /></label>
      <select aria-label="Relationship filter" value={relation} onChange={e => setRelation(e.target.value)} className="bg-input border border-border p-2 text-xs max-w-full"><option value="">All relationships</option>{[...new Set(data.edges.map(e => e.relation))].sort().map(r => <option key={r} value={r}>{r.replace(/_/g, ' ').toLowerCase()}</option>)}</select>
      <span className="text-xs text-muted-foreground">{graph.nodes.length} entries · {graph.edges.length} connections shown</span>
    </div>
    <div className="flex flex-wrap gap-4 text-[10px] uppercase"><span className="text-primary">● Aircraft</span><span className="text-accent">● Company</span><span className="text-neon-cyan">● Other entities</span></div>
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-4">
      <div className="min-w-0">{graph.nodes.length ? <ClientOnly fallback={<Loading />}><Suspense fallback={<Loading />}><Canvas nodes={graph.nodes} edges={graph.edges} selected={selected} onSelect={pickNode} onEdgeSelect={id => { setEdgeId(id); setSelected(null); }} /></Suspense></ClientOnly> : <div className="h-64 grid place-items-center text-sm text-muted-foreground border border-border">No matching network entries.</div>}</div>
      <aside className="border-l border-border pl-4 space-y-3 min-w-0">
        <div className="flex justify-between items-center"><h2 className="text-xs uppercase text-accent">{node ? 'Entity record' : edge ? 'Relationship record' : 'Network directory'}</h2>{(node || edge) && <Button variant="ghost" size="icon" aria-label="Close record" title="Close record" onClick={() => { setSelected(null); setEdgeId(null); }}><X /></Button>}</div>
        {node ? <><h3 className="text-sm text-primary break-words">{node.label}</h3><p className="text-xs text-muted-foreground">{node.kind} · Recorded {node.recordedAt ? new Date(node.recordedAt).toLocaleDateString() : 'date unknown'}</p>{Object.keys(node.metadata).length > 0 && <pre className="text-[11px] whitespace-pre-wrap break-words">{JSON.stringify(node.metadata, null, 2)}</pre>}<p className="text-xs text-muted-foreground">{related.length} recorded connections</p>{related.map(e => <Button key={e.id} variant="outline" className="h-auto w-full text-left justify-start whitespace-normal text-xs py-2" onClick={() => { setEdgeId(e.id); setSelected(null); }}>{e.relation.replace(/_/g, ' ').toLowerCase()} · {label(e.source === node.id ? e.target : e.source)}</Button>)}<Button variant="outline" size="sm" asChild><Link to="/intel">Ask Josiah</Link></Button></> : edge ? <><p className="text-sm break-words">{label(edge.source)}</p><p className="text-xs text-accent">{edge.relation.replace(/_/g, ' ').toLowerCase()}</p><p className="text-sm break-words">{label(edge.target)}</p><p className="text-xs text-muted-foreground">Stored weight: {edge.weight ?? 'not supplied'} (not a confidence percentage)</p><p className="text-xs text-muted-foreground">Recorded {edge.recordedAt ? new Date(edge.recordedAt).toLocaleDateString() : 'date unknown'}</p><pre className="text-[11px] whitespace-pre-wrap break-words">{Object.keys(edge.metadata).length ? JSON.stringify(edge.metadata, null, 2) : 'No supporting metadata stored.'}</pre><Button variant="outline" size="sm" onClick={() => pickNode(edge.source)}>Source record</Button><Button variant="outline" size="sm" onClick={() => pickNode(edge.target)}>Target record</Button></> : <div className="max-h-[530px] overflow-auto space-y-1">{graph.nodes.map(n => <Button key={n.id} variant="ghost" onClick={() => pickNode(n.id)} className="w-full justify-start h-auto py-2 text-xs whitespace-normal text-left">{n.label}</Button>)}</div>}
        <p className="text-[10px] text-muted-foreground break-words">Source: shell_network_nodes / shell_network_edges</p>
      </aside>
    </div>
  </div>;
}