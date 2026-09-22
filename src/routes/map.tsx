import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Globe2, Loader2, Network, X, Plane, Building2, FolderOpen, Radar } from "lucide-react";
import {
  getAirspaceMap,
  getEntityGraph,
  getNodeDossier,
  type MapFilter,
  type MapContact,
  type GraphNode,
} from "@/lib/intel-map.functions";
import { LoadErrorPanel } from "@/components/LoadErrorPanel";
import { ExportBar } from "@/components/ExportBar";

export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "Intelligence Map // Watchtower" },
      {
        name: "description",
        content:
          "A live picture of the airspace and the ownership network behind it — aircraft, owners, shell filings and open cases on one board.",
      },
      { property: "og:title", content: "Intelligence Map // Watchtower" },
      {
        property: "og:description",
        content: "Watchtower's intelligence map links flight tracks, registered owners, corporate filings and case files.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MapPage,
  errorComponent: ({ error, reset }) => (
    <LoadErrorPanel error={error} reset={reset} title="The intelligence map didn't load" />
  ),
});

const FILTERS: Array<{ key: MapFilter; label: string; hint: string }> = [
  { key: "all", label: "Everything", hint: "every aircraft seen in the window" },
  { key: "low", label: "Below 500 ft", hint: "low enough to be watching the ground" },
  { key: "masked", label: "Masked / unnamed", hint: "no registration or call sign broadcast" },
  { key: "kcso", label: "KCSO fleet", hint: "aircraft tied to the sheriff's office" },
  { key: "military", label: "Military", hint: "flagged as military airframes" },
];

const WINDOWS = [
  { h: 6, label: "6 hours" },
  { h: 24, label: "24 hours" },
  { h: 72, label: "3 days" },
  { h: 168, label: "7 days" },
];

function pad(b: { min_lat: number; max_lat: number; min_lon: number; max_lon: number }) {
  const dy = Math.max(b.max_lat - b.min_lat, 0.15) * 0.08;
  const dx = Math.max(b.max_lon - b.min_lon, 0.15) * 0.08;
  return { min_lat: b.min_lat - dy, max_lat: b.max_lat + dy, min_lon: b.min_lon - dx, max_lon: b.max_lon + dx };
}

function MapPage() {
  const [filter, setFilter] = useState<MapFilter>("all");
  const [hours, setHours] = useState(24);
  const [view, setView] = useState<"airspace" | "network">("airspace");
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const air = useQuery({
    queryKey: ["intel-map-airspace", filter, hours],
    queryFn: () => getAirspaceMap({ data: { filter, hours } }),
    refetchInterval: 120_000,
  });

  const graph = useQuery({
    queryKey: ["intel-map-graph", filter, hours, focus],
    queryFn: () => getEntityGraph({ data: { filter, hours, icao: focus ?? undefined } }),
    enabled: view === "network",
  });

  const dossier = useQuery({
    queryKey: ["intel-map-dossier", selected],
    queryFn: () => getNodeDossier({ data: { icao: selected! } }),
    enabled: Boolean(selected),
  });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <header>
        <h1 className="text-2xl neon-text-orange flex items-center gap-2">
          <Globe2 className="size-6" /> Intelligence Map
        </h1>
        <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
          Two views of the same evidence. <span className="text-accent">Airspace</span> shows where aircraft actually
          flew. <span className="text-accent">Network</span> shows who owns them, who they fly with, and which case
          files they already belong to. Click anything to read it in plain English.
        </p>
        <ExportBar
          rows={air.data?.contacts as unknown as Array<Record<string, unknown>>}
          fileName="intelligence-map"
          note="csv = aircraft shown · print = full page"
        />
      </header>

      {/* Controls */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <div className="flex rounded-sm overflow-hidden border border-border">
          {(["airspace", "network"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-[11px] uppercase tracking-widest flex items-center gap-2 ${
                view === v ? "bg-accent/20 text-accent" : "text-muted-foreground hover:bg-card"
              }`}
            >
              {v === "airspace" ? <Radar className="size-3" /> : <Network className="size-3" />} {v}
            </button>
          ))}
        </div>

        {FILTERS.map((f) => (
          <button
            key={f.key}
            title={f.hint}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-[11px] uppercase tracking-widest rounded-sm border ${
              filter === f.key
                ? "border-accent text-accent bg-accent/10"
                : "border-border text-muted-foreground hover:bg-card"
            }`}
          >
            {f.label}
          </button>
        ))}

        <select
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className="bg-card border border-border rounded-sm px-2 py-1.5 text-[11px] uppercase tracking-widest"
        >
          {WINDOWS.map((w) => (
            <option key={w.h} value={w.h}>
              Last {w.label}
            </option>
          ))}
        </select>

        {focus && view === "network" && (
          <button
            onClick={() => setFocus(null)}
            className="px-3 py-1.5 text-[11px] uppercase tracking-widest rounded-sm border border-primary text-primary"
          >
            Clear focus ✕
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-4 items-start">
        <div className="panel p-3 min-h-[520px]">
          {view === "airspace" ? (
            air.isLoading ? (
              <Loading text="Drawing the airspace…" />
            ) : air.isError ? (
              <LoadErrorPanel error={air.error} reset={() => air.refetch()} title="Airspace unavailable" />
            ) : (
              <AirspaceView data={air.data!} selected={selected} onSelect={setSelected} />
            )
          ) : graph.isLoading ? (
            <Loading text="Mapping the network…" />
          ) : graph.isError ? (
            <LoadErrorPanel error={graph.error} reset={() => graph.refetch()} title="Network unavailable" />
          ) : (
            <NetworkView
              nodes={graph.data?.nodes ?? []}
              edges={graph.data?.edges ?? []}
              onSelect={(n) => n.icao && setSelected(n.icao)}
            />
          )}
        </div>

        <aside className="space-y-3">
          {selected ? (
            <Inspector
              loading={dossier.isLoading}
              data={dossier.data}
              onClose={() => setSelected(null)}
              onFocus={(icao) => {
                setFocus(icao);
                setView("network");
              }}
              onTwin={(icao) => setSelected(icao.toLowerCase())}
            />
          ) : (
            <div className="panel p-4 text-xs text-muted-foreground space-y-2">
              <div className="text-sm neon-text-green">Nothing selected</div>
              <p>Click an aircraft track, a hotspot, or a node in the network to open its file here.</p>
              {air.data && (
                <ul className="pt-2 space-y-1 text-[11px]">
                  <li>
                    <b className="text-foreground">{air.data.total_contacts.toLocaleString()}</b> aircraft matched this
                    filter
                  </li>
                  <li>
                    <b className="text-foreground">{air.data.contacts.filter((c) => c.low_alt).length}</b> of those flew
                    below 500 ft
                  </li>
                  <li>
                    <b className="text-foreground">{air.data.contacts.filter((c) => c.masked).length}</b> broadcast no
                    registration
                  </li>
                  <li>
                    <b className="text-foreground">{air.data.zones.filter((z) => z.kind === "convergence").length}</b>{" "}
                    places where aircraft bunched up together
                  </li>
                </ul>
              )}
            </div>
          )}

          <Legend view={view} />
        </aside>
      </div>
    </div>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="h-[480px] flex items-center justify-center text-xs text-muted-foreground gap-2">
      <Loader2 className="size-4 animate-spin" /> {text}
    </div>
  );
}

// ------------------------------------------------------------------- airspace

function AirspaceView({
  data,
  selected,
  onSelect,
}: {
  data: NonNullable<ReturnType<typeof getAirspaceMap> extends Promise<infer T> ? T : never>;
  selected: string | null;
  onSelect: (icao: string) => void;
}) {
  const W = 900;
  const H = 540;

  const box = useMemo(() => (data.bbox ? pad(data.bbox) : null), [data.bbox]);

  if (!box) {
    return (
      <div className="h-[480px] flex items-center justify-center text-xs text-muted-foreground">
        No aircraft positions in this window.
      </div>
    );
  }

  const project = (lat: number, lon: number) => {
    const x = ((lon - box.min_lon) / (box.max_lon - box.min_lon)) * W;
    const y = H - ((lat - box.min_lat) / (box.max_lat - box.min_lat)) * H;
    return [x, y] as const;
  };

  const kmPerDegLon = 111 * Math.cos(((box.min_lat + box.max_lat) / 2) * (Math.PI / 180));
  const radiusPx = (km: number) => Math.max(4, (km / kmPerDegLon / (box.max_lon - box.min_lon)) * W);

  const colorFor = (c: MapContact) =>
    c.kcso ? "#ff7a1a" : c.masked ? "#ff3b6b" : c.low_alt ? "#ffd166" : "#39ff88";

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-sm bg-[#05070a]">
        <defs>
          <pattern id="grid" width="45" height="45" patternUnits="userSpaceOnUse">
            <path d="M 45 0 L 0 0 0 45" fill="none" stroke="#12331f" strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#grid)" />

        {/* zones */}
        {data.zones.map((z) => {
          const [x, y] = project(z.lat, z.lon);
          if (x < -50 || x > W + 50 || y < -50 || y > H + 50) return null;
          const isConv = z.kind === "convergence";
          return (
            <g key={z.id}>
              <circle
                cx={x}
                cy={y}
                r={radiusPx(z.radius_km)}
                fill={isConv ? "rgba(255,122,26,0.09)" : "rgba(57,255,136,0.05)"}
                stroke={isConv ? "#ff7a1a" : "#39ff88"}
                strokeOpacity={0.45}
                strokeDasharray={isConv ? "4 3" : "1 4"}
                strokeWidth={1}
              />
              {!isConv && (
                <text x={x} y={y - radiusPx(z.radius_km) - 4} fill="#5c7a68" fontSize="9" textAnchor="middle">
                  {z.name}
                </text>
              )}
            </g>
          );
        })}

        {/* tracks */}
        {data.contacts.map((c) => {
          if (c.track.length < 2) return null;
          const pts = c.track.map((p) => project(p.lat, p.lon).join(",")).join(" ");
          const isSel = selected === c.icao_hex.toLowerCase();
          return (
            <polyline
              key={`t-${c.icao_hex}`}
              points={pts}
              fill="none"
              stroke={colorFor(c)}
              strokeOpacity={isSel ? 1 : 0.5}
              strokeWidth={isSel ? 2.2 : 1}
            />
          );
        })}

        {/* current positions */}
        {data.contacts.map((c) => {
          const last = c.track[c.track.length - 1];
          if (!last) return null;
          const [x, y] = project(last.lat, last.lon);
          const isSel = selected === c.icao_hex.toLowerCase();
          return (
            <g
              key={`p-${c.icao_hex}`}
              className="cursor-pointer"
              onClick={() => onSelect(c.icao_hex.toLowerCase())}
            >
              <circle cx={x} cy={y} r={isSel ? 7 : 3.4} fill={colorFor(c)} fillOpacity={isSel ? 0.95 : 0.85} />
              {isSel && <circle cx={x} cy={y} r={13} fill="none" stroke={colorFor(c)} strokeWidth="1" />}
              <circle cx={x} cy={y} r={12} fill="transparent" />
              {(isSel || c.kcso || c.masked) && (
                <text x={x + 9} y={y + 3} fill={colorFor(c)} fontSize="9">
                  {c.registration ?? "NO REG"}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>Showing {data.contacts.length} of {data.total_contacts.toLocaleString()} aircraft</span>
        {data.anchor && <span>Latest position {new Date(data.anchor).toLocaleString()}</span>}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- network

const KIND_COLOR: Record<GraphNode["kind"], string> = {
  aircraft: "#39ff88",
  owner: "#ff7a1a",
  shell: "#c06bff",
  case: "#ff3b6b",
  county: "#56b7ff",
};

function NetworkView({
  nodes,
  edges,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: Array<{ source: string; target: string; kind: string; label: string; weight: number }>;
  onSelect: (n: GraphNode) => void;
}) {
  const W = 900;
  const H = 560;
  const [hover, setHover] = useState<string | null>(null);

  const positions = useMemo(() => {
    // Deterministic layered layout: owners and filings on the outer ring,
    // aircraft in the middle ring, case files at the centre.
    const rings: Record<GraphNode["kind"], number> = {
      case: 0.16,
      aircraft: 0.44,
      owner: 0.78,
      shell: 0.94,
      county: 0.9,
    };
    const byKind = new Map<string, GraphNode[]>();
    for (const n of nodes) {
      const arr = byKind.get(n.kind) ?? [];
      arr.push(n);
      byKind.set(n.kind, arr);
    }
    const pos = new Map<string, { x: number; y: number }>();
    for (const [kind, list] of byKind) {
      const r = (rings[kind as GraphNode["kind"]] ?? 0.6) * Math.min(W, H) * 0.46;
      list.forEach((n, i) => {
        const a = (i / Math.max(1, list.length)) * Math.PI * 2 + (kind === "owner" ? 0.4 : 0);
        pos.set(n.id, { x: W / 2 + Math.cos(a) * r * 1.5, y: H / 2 + Math.sin(a) * r });
      });
    }
    return pos;
  }, [nodes]);

  if (nodes.length === 0) {
    return (
      <div className="h-[480px] flex items-center justify-center text-xs text-muted-foreground">
        Nothing to connect in this window.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-sm bg-[#05070a]">
        {edges.map((e, i) => {
          const a = positions.get(e.source);
          const b = positions.get(e.target);
          if (!a || !b) return null;
          const lit = hover === e.source || hover === e.target;
          const stroke =
            e.kind === "co_flew" ? "#39ff88" : e.kind === "evidence_in" ? "#ff3b6b" : e.kind === "corporate" ? "#c06bff" : "#ff7a1a";
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={stroke}
              strokeOpacity={lit ? 0.9 : 0.18}
              strokeWidth={lit ? 1.8 : e.kind === "co_flew" ? Math.min(2.5, 0.5 + e.weight / 25) : 0.8}
            />
          );
        })}

        {nodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          const c = KIND_COLOR[n.kind];
          const r = n.kind === "aircraft" ? 6 : n.kind === "case" ? 8 : 5;
          return (
            <g
              key={n.id}
              className={n.kind === "aircraft" ? "cursor-pointer" : ""}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect(n)}
            >
              {n.flagged && <circle cx={p.x} cy={p.y} r={r + 5} fill="none" stroke={c} strokeOpacity={0.5} />}
              <circle cx={p.x} cy={p.y} r={r} fill={c} fillOpacity={0.9} />
              <text
                x={p.x + r + 4}
                y={p.y + 3}
                fill={hover === n.id ? c : "#7c8f85"}
                fontSize={hover === n.id ? 11 : 9}
              >
                {n.label.length > 26 ? `${n.label.slice(0, 24)}…` : n.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>{nodes.length} entities</span>
        <span>{edges.length} connections</span>
        <span className="text-accent">click an aircraft to open its file</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ inspector

function Inspector({
  loading,
  data,
  onClose,
  onFocus,
  onTwin,
}: {
  loading: boolean;
  data?: Awaited<ReturnType<typeof getNodeDossier>>;
  onClose: () => void;
  onFocus: (icao: string) => void;
  onTwin: (icao: string) => void;
}) {
  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm neon-text-orange flex items-center gap-2">
          <Plane className="size-4" /> {data?.registration ?? data?.icao_hex?.toUpperCase() ?? "Loading"}
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>

      {loading && (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-3 animate-spin" /> Pulling the file…
        </div>
      )}

      {data && (
        <div className="space-y-3 text-xs">
          <p className="text-muted-foreground">
            {data.registration ? (
              <>
                <b className="text-foreground">{data.registration}</b>
                {data.aircraft_model ? ` — a ${data.aircraft_model}` : ""}
                {data.operator ? `, registered to ${data.operator}.` : "."}
              </>
            ) : (
              <>This aircraft broadcast no registration. It is tracked only by its transponder code.</>
            )}{" "}
            It has been seen <b className="text-foreground">{data.detections_30d.toLocaleString()}</b> times in the last
            30 days
            {data.low_alt_30d > 0 && (
              <>
                , <b className="text-primary">{data.low_alt_30d.toLocaleString()}</b> of them below 500 ft
              </>
            )}
            .
          </p>

          <div className="grid grid-cols-2 gap-2">
            <Fact label="Flagged events" value={data.anomalies.toLocaleString()} />
            <Fact label="Most common flag" value={data.top_anomaly ? data.top_anomaly.replace(/_/g, " ").toLowerCase() : "none"} />
            <Fact label="Behaviour group" value={data.behaviour_cluster == null || data.behaviour_cluster < 0 ? "not grouped" : `#${data.behaviour_cluster}`} />
            <Fact label="Counties seen in" value={data.counties.length ? data.counties.slice(0, 3).join(", ") : "—"} />
          </div>

          {(data.kcso || data.military) && (
            <div className="text-[11px] uppercase tracking-widest text-primary">
              {data.kcso ? "Sheriff's office fleet" : "Military airframe"}
            </div>
          )}

          {data.cases.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1">
                <FolderOpen className="size-3" /> Already in these case files
              </div>
              <ul className="space-y-1">
                {data.cases.map((c) => (
                  <li key={c.case_id} className="flex items-center justify-between">
                    <a href={`/cases/${c.case_id}`} className="text-accent hover:underline">
                      {c.case_id}
                    </a>
                    <span className="text-[10px] uppercase text-muted-foreground">
                      {c.severity ?? "—"} · {c.status ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.twins.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1">
                <Building2 className="size-3" /> Flies like these aircraft
              </div>
              <p className="text-[11px] text-muted-foreground mb-1">
                Matched on flight behaviour alone, not on ownership. Useful when a tail number is hidden.
              </p>
              <ul className="space-y-1">
                {data.twins.slice(0, 6).map((t) => (
                  <li key={t.icao_hex} className="flex items-center justify-between gap-2">
                    <button onClick={() => onTwin(t.icao_hex)} className="text-accent hover:underline truncate">
                      {t.registration ?? t.icao_hex.toUpperCase()}
                    </button>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {Math.round(Number(t.similarity) * 100)}% alike
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={() => onFocus(data.icao_hex)}
            className="w-full px-3 py-2 text-[11px] uppercase tracking-widest border border-accent text-accent rounded-sm hover:bg-accent/10"
          >
            Show this aircraft's network
          </button>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-sm p-2">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-xs mt-0.5 truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

function Legend({ view }: { view: "airspace" | "network" }) {
  const items =
    view === "airspace"
      ? [
          { c: "#ff7a1a", t: "Sheriff's office aircraft" },
          { c: "#ff3b6b", t: "No registration broadcast" },
          { c: "#ffd166", t: "Dropped below 500 ft" },
          { c: "#39ff88", t: "Everything else" },
        ]
      : [
          { c: "#39ff88", t: "Aircraft" },
          { c: "#ff7a1a", t: "Registered owner" },
          { c: "#c06bff", t: "Corporate filing" },
          { c: "#ff3b6b", t: "Case file" },
        ];
  return (
    <div className="panel p-3 space-y-1.5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Legend</div>
      {items.map((i) => (
        <div key={i.t} className="flex items-center gap-2 text-xs">
          <span className="size-2.5 rounded-full" style={{ background: i.c }} />
          <span className="text-muted-foreground">{i.t}</span>
        </div>
      ))}
    </div>
  );
}
