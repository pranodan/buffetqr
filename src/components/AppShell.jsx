import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutGrid,
  ScanLine,
  UserPlus,
  Users,
  RefreshCw,
  MoreHorizontal,
  FileUp,
  Printer,
  Ticket,
  ShieldAlert,
  BarChart3,
  ScrollText,
  Settings,
  LogOut,
  CloudOff,
  Cloud,
  Leaf,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import PwaSetup from "@/components/PwaSetup";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { runSync } from "@/lib/sync";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutGrid, roles: ["admin", "registration", "buffet"] },
  { to: "/scanner", label: "Scanner", icon: ScanLine, roles: ["admin", "buffet"] },
  { to: "/spot", label: "Register", icon: UserPlus, roles: ["admin", "registration"] },
  { to: "/participants", label: "People", icon: Users, roles: ["admin", "registration"] },
  { to: "/slips", label: "QR slips", icon: Printer, roles: ["admin", "registration"] },
  { to: "/sync", label: "Sync", icon: RefreshCw, roles: ["admin", "registration", "buffet"] },
  { to: "/import", label: "Import list", icon: FileUp, roles: ["admin"] },
  { to: "/reserve", label: "Reserve passes", icon: Ticket, roles: ["admin"] },
  { to: "/exception", label: "Manual exception", icon: ShieldAlert, roles: ["admin"] },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: ["admin"] },
  { to: "/audit", label: "Audit log", icon: ScrollText, roles: ["admin"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["admin"] },
];

function isActive(pathname, to) {
  return to === "/" ? pathname === "/" : pathname.startsWith(to);
}

export default function AppShell({ children, role = "admin", conferenceName = "Conference buffet" }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, logout } = useAuth();
  const sync = useSyncStatus();
  const [moreOpen, setMoreOpen] = useState(false);

  const allowed = NAV.filter((item) => item.roles.includes(role));
  const mainItems = allowed.slice(0, 4);
  const moreItems = allowed.slice(4);
  const columns = mainItems.length + (moreItems.length ? 1 : 0);

  return (
    <div className="min-h-screen bg-background">
      <PwaSetup />
      <div className="mx-auto flex w-full max-w-6xl">
        <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border/70 bg-card/60 px-3 py-5 lg:flex">
          <Link to="/" className="mb-6 flex items-center gap-2.5 px-2">
            <BrandMark />
            <div className="leading-tight">
              <BrandWordmark />
              <div className="text-[11px] text-muted-foreground">QR check-in</div>
            </div>
          </Link>
          <nav className="flex-1 space-y-0.5 overflow-y-auto">
            {allowed.map((item) => (
              <NavItem key={item.to} {...item} active={isActive(pathname, item.to)} />
            ))}
          </nav>
          <div className="mt-4 border-t border-border/70 pt-3">
            <div className="px-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              {conferenceName}
            </div>
            <button
              onClick={() => logout()}
              className="mt-2 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border/60 bg-background/85 px-4 py-3 backdrop-blur lg:hidden">
            <Link to="/" className="flex items-center gap-2">
              <BrandMark />
              <BrandWordmark />
            </Link>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => runSync("manual")}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium",
                  sync.online ? "bg-muted text-muted-foreground" : "bg-warning/10 text-warning"
                )}
              >
                {sync.online ? <Cloud className="h-3 w-3" /> : <CloudOff className="h-3 w-3" />}
                {sync.running ? "syncing" : sync.pending ? `${sync.pending} pending` : sync.online ? "synced" : "offline"}
              </button>
              <div className="grid h-8 w-8 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                {(user?.full_name || user?.email || "?").slice(0, 2).toUpperCase()}
              </div>
            </div>
          </header>

          <main className="px-4 pb-28 pt-4 lg:px-8 lg:pb-12 lg:pt-8">{children}</main>
        </div>
      </div>

      <nav className="no-print safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-card/95 backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {mainItems.map((item) => (
            <BottomItem key={item.to} {...item} active={isActive(pathname, item.to)} />
          ))}
          {moreItems.length ? (
            <button
              onClick={() => setMoreOpen(true)}
              className="flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-muted-foreground"
            >
              <MoreHorizontal className="h-5 w-5" />
              More
            </button>
          ) : null}
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl pb-8">
          <SheetHeader className="mb-2 text-left">
            <SheetTitle className="font-heading text-base">All modules</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-2">
            {[...mainItems, ...moreItems].map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3 py-3 text-sm transition-colors hover:bg-muted"
                >
                  <Icon className="h-4 w-4 text-primary" />
                  {item.label}
                </Link>
              );
            })}
          </div>
          <button
            onClick={() => logout()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-border px-3 py-3 text-sm text-muted-foreground"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function BrandMark() {
  return (
    <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-primary text-primary-foreground">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
        <rect x="3" y="3" width="7" height="7" rx="1.6" />
        <rect x="14" y="3" width="7" height="7" rx="1.6" />
        <rect x="3" y="14" width="7" height="7" rx="1.6" />
        <path d="M14 14h3v3h-3zM20 14v.01M20 20v.01M14 20v.01" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function BrandWordmark() {
  return (
    <span
      role="img"
      aria-label="Buffet by Pranodan"
      className="inline-flex items-center gap-1 font-heading text-sm leading-none"
    >
      <span className="font-bold text-red-600">Buffe</span>
      <Leaf className="h-3 w-3 fill-green-600 text-green-700" aria-hidden="true" />
      <span className="font-light italic text-foreground">by</span>
      <span className="font-semibold text-green-700">Pranodan</span>
    </span>
  );
}

function NavItem({ to, label, icon: Icon, active }) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
        active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function BottomItem({ to, label, icon: Icon, active }) {
  return (
    <Link
      to={to}
      className={cn(
        "flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors",
        active ? "text-primary" : "text-muted-foreground"
      )}
    >
      <Icon className={cn("h-5 w-5", active && "scale-105")} strokeWidth={active ? 2.3 : 1.9} />
      {label}
    </Link>
  );
}