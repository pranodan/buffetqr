import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ScanLine, UserPlus, Printer, FileUp, ArrowUpRight, CloudOff, Loader2, RefreshCw } from "lucide-react";
import AppShell from "@/components/AppShell";
import PageLoading from "@/components/PageLoading";
import { useAppSession } from "@/hooks/useAppSession";
import { useConference } from "@/hooks/useConference";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { computeStats } from "@/lib/stats";
import { relativeTime, pct } from "@/lib/format";
import { runSync } from "@/lib/sync";
import { can } from "@/lib/roles";

export const Route = createFileRoute("/_authed/")({
  head: () => ({ meta: [{ title: "Overview · Buffet Access" }] }),
  component: OverviewPage,
});

function OverviewPage() {
  const { role, loading } = useAppSession();
  const { conference, ready } = useConference();
  const sync = useSyncStatus();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    computeStats().then(setStats);
  }, [sync.lastSync]);

  if (loading || !ready) {
    return (
      <AppShell role={role || "admin"}>
        <PageLoading label="Loading overview" />
      </AppShell>
    );
  }

  const s = stats || {
    counts: { total: 0, pre: 0, spot: 0, manual: 0, active: 0, revoked: 0, reserveUnused: 0, reserveAssigned: 0 },
    sessions: {
      day1: { eligible: 0, redeemed: 0, manual: 0, duplicates: 0, invalid: 0, ineligible: 0 },
      day2: { eligible: 0, redeemed: 0, manual: 0, duplicates: 0, invalid: 0, ineligible: 0 },
    },
  };

  const days = [
    { id: "day1", label: "Day 1", name: conference.day1_name, date: conference.day1_date },
    { id: "day2", label: "Day 2", name: conference.day2_name, date: conference.day2_date },
  ];

  return (
    <AppShell role={role} conferenceName={conference.name}>
      <div className="space-y-5">
        <section className="overflow-hidden rounded-3xl bg-primary px-5 pb-6 pt-6 text-primary-foreground shadow-[0_18px_40px_-28px_rgba(9,50,42,0.9)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-primary-foreground/60">
                {conference.name}
              </p>
              <h1 className="mt-2 font-heading text-[26px] font-semibold leading-tight">
                Buffet access desk
              </h1>
              <p className="mt-1 text-sm text-primary-foreground/70">
                {s.counts.total} participants · two sessions
              </p>
            </div>
            <span className="rounded-full bg-primary-foreground/12 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-primary-foreground/80">
              {role === "admin" ? "Super admin" : role === "buffet" ? "Buffet" : "Registration"}
            </span>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground/12 px-3 py-1.5 text-xs">
              <span className={`h-1.5 w-1.5 rounded-full ${sync.online ? "bg-emerald-300" : "bg-amber-300"}`} />
              {sync.online ? "Online" : "Offline ready"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground/12 px-3 py-1.5 text-xs">
              <CloudOff className="h-3.5 w-3.5" /> {sync.pending} pending change{sync.pending === 1 ? "" : "s"}
            </span>
            <button
              onClick={() => runSync("manual")}
              disabled={sync.running}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground/15 px-3 py-1.5 text-xs font-medium disabled:opacity-60"
            >
              {sync.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {sync.running ? "Syncing" : `Synced ${relativeTime(sync.lastSync)}`}
            </button>
          </div>
        </section>

        {!s.counts.total ? (
          <section className="rounded-2xl border border-dashed border-border bg-card p-5">
            <h2 className="font-heading text-base font-semibold">No participants on this phone yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Import the registration list once, or sync to pull records another phone has uploaded.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {can(role, "import") ? (
                <Link
                  to="/import"
                  className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
                >
                  Import participant list
                </Link>
              ) : null}
              <button
                onClick={() => runSync("manual")}
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium"
              >
                Sync now
              </button>
            </div>
          </section>
        ) : null}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Registered" value={s.counts.total} hint={`${s.counts.pre} pre · ${s.counts.spot} spot`} />
          <Tile label="Active passes" value={s.counts.active} hint={`${s.counts.reserveUnused} reserve unused`} />
          <Tile
            label="Day 1 redeemed"
            value={s.sessions.day1.redeemed}
            hint={`of ${s.sessions.day1.eligible} eligible`}
          />
          <Tile
            label="Day 2 redeemed"
            value={s.sessions.day2.redeemed}
            hint={`of ${s.sessions.day2.eligible} eligible`}
          />
        </section>

        <section className="grid gap-3 lg:grid-cols-2">
          {days.map((d) => {
            const bucket = s.sessions[d.id];
            const percentage = pct(bucket.redeemed, bucket.eligible);
            return (
              <div key={d.id} className="rounded-2xl border border-border/70 bg-card p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {d.label}
                      {conference.active_session === d.id ? " · active" : ""}
                    </p>
                    <h2 className="mt-1 font-heading text-base font-semibold">{d.name}</h2>
                  </div>
                  <span className="num font-heading text-2xl font-semibold text-primary">{percentage}%</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percentage}%` }} />
                </div>
                <p className="num mt-2 text-xs text-muted-foreground">
                  {bucket.redeemed} redeemed · {Math.max(bucket.eligible - bucket.redeemed, 0)} remaining ·{" "}
                  {bucket.duplicates} duplicate attempt{bucket.duplicates === 1 ? "" : "s"}
                </p>
              </div>
            );
          })}
        </section>

        <section>
          <h2 className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Quick actions
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {can(role, "scanner") ? (
              <Action to="/scanner" icon={ScanLine} title="Open scanner" hint="Buffet entrance" primary />
            ) : null}
            {can(role, "register") ? (
              <Action to="/spot" icon={UserPlus} title="Spot registration" hint="Walk-in guest" />
            ) : null}
            {can(role, "slips") ? (
              <Action to="/slips" icon={Printer} title="Print QR slips" hint="6 per A4 page" />
            ) : null}
            {can(role, "import") ? (
              <Action to="/import" icon={FileUp} title="Import list" hint="CSV upload" />
            ) : null}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function Tile({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="num mt-1.5 font-heading text-[28px] font-semibold leading-none">{value}</p>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function Action({ to, icon: Icon, title, hint, primary }) {
  return (
    <Link
      to={to}
      className={
        primary
          ? "group flex flex-col justify-between rounded-2xl bg-primary p-4 text-primary-foreground transition-transform active:scale-[0.98]"
          : "group flex flex-col justify-between rounded-2xl border border-border/70 bg-card p-4 transition-all hover:border-primary/30 active:scale-[0.98]"
      }
    >
      <div className="flex items-start justify-between">
        <Icon className={primary ? "h-5 w-5" : "h-5 w-5 text-primary"} />
        <ArrowUpRight
          className={
            primary
              ? "h-4 w-4 opacity-50 transition-opacity group-hover:opacity-100"
              : "h-4 w-4 text-muted-foreground/60 transition-opacity group-hover:text-primary"
          }
        />
      </div>
      <div className="mt-6">
        <p className="font-heading text-sm font-semibold">{title}</p>
        <p className={primary ? "text-[11px] text-primary-foreground/70" : "text-[11px] text-muted-foreground"}>
          {hint}
        </p>
      </div>
    </Link>
  );
}