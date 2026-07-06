import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, AlertTriangle, FolderOpen, Radio, Brain, Shield, Radar, Gavel, Users, BookOpen, ShieldAlert, Network, Library, Camera, Newspaper } from "lucide-react";
import type { ReactNode } from "react";

const nav = [
  { to: "/", label: "Command", icon: Radar },
  { to: "/narrative", label: "Daily Narrative", icon: Newspaper },
  { to: "/alerts", label: "Live Alerts", icon: AlertTriangle },
  { to: "/spoofing", label: "Spoofing", icon: ShieldAlert },
  { to: "/coordination", label: "Coordination", icon: Network },
  { to: "/violations", label: "FAA Violations", icon: Gavel },
  { to: "/cases", label: "Cases", icon: FolderOpen },
  { to: "/detections", label: "Detections", icon: Radio },
  { to: "/operators", label: "Operators", icon: Users },
  { to: "/regulations", label: "Regulations", icon: BookOpen },
  { to: "/doctrine", label: "Doctrine", icon: Library },
  { to: "/screenshots", label: "Screenshots", icon: Camera },
  { to: "/intel", label: "Josiah", icon: Brain },
] as const;

function StatusPill() {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="size-2 rounded-full bg-accent blink" />
      <span className="text-accent">LIVE</span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-border bg-sidebar flex md:min-h-screen md:flex-col">
        <div className="px-4 py-4 md:py-5 border-r md:border-r-0 md:border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="size-5 text-primary" strokeWidth={2.5} />
            <div>
              <div className="text-sm font-bold neon-text-orange leading-none">WATCHTOWER</div>
              <div className="text-[10px] text-muted-foreground mt-1 tracking-widest">
                COMMAND // v2.0
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-2 flex gap-1 overflow-x-auto md:block md:space-y-1 md:overflow-visible">
          {nav.map(({ to, label, icon: Icon }) => {
            const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={`flex shrink-0 items-center gap-2 md:gap-3 px-3 py-2 text-xs uppercase tracking-wider rounded-sm transition-all border-b-2 md:border-b-0 md:border-l-2 ${
                  active
                    ? "bg-sidebar-accent text-accent border-accent"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 border-transparent"
                }`}
              >
                <Icon className="size-4" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="hidden md:block p-3 border-t border-border text-[10px] text-muted-foreground space-y-1">
          <div className="flex items-center justify-between">
            <span>NEON</span>
            <span className="text-accent">● ONLINE</span>
          </div>
          <div className="flex items-center justify-between">
            <span>ML BRAIN</span>
            <span className="text-accent">● ACTIVE</span>
          </div>
          <div className="flex items-center justify-between">
            <span>MERKLE</span>
            <span className="text-accent">● SEALED</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-border bg-card/60 backdrop-blur flex items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground">
            <Activity className="size-4 text-accent" />
            <span className="truncate">advocacywatch.live // command center</span>
          </div>
          <StatusPill />
        </header>
        <div className="flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}
