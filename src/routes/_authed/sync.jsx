import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RefreshCw, Loader2, Smartphone, CloudOff, CheckCircle2, AlertTriangle } from "lucide-react";
import AppShell from "@/components/AppShell";
import PageLoading from "@/components/PageLoading";
import PageHeader from "@/components/PageHeader";
import { useAppSession } from "@/hooks/useAppSession";
import { useConference } from "@/hooks/useConference";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { dbAll } from "@/lib/db";
import { runSync } from "@/lib/sync";
import { formatNPT, relativeTime } from "@/lib/format";
import { getDeviceId } from "@/lib/device";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/sync")({
  head: () => ({ meta: [{ title: "Sync · Buffet Access" }] }),
  component: SyncPage,
});

const KIND_LABELS = {
  participant: "Participant record",
  redemption: "Buffet entry",
  audit: "Audit event",
  token: "Reserve pass",
  setting: "Conference settings",
  staff: "Staff role",
};

function SyncPage() {
  const { role, loading } = useAppSession();
  const { conference, ready } = useConference();
  const sync = useSyncStatus();
  const [outbox, setOutbox] = useState([]);
  const [counts, setCounts] = useState({ participants: 0, redemptions: 0, audits: 0 });

  const refresh = async () => {
    const [items, participants, redemptions, audits] = await Promise.all([
      dbAll("outbox"),
      dbAll("participants"),
      dbAll("redemptions"),
      dbAll("audits"),
    ]);
    setOutbox(items.sort((a, b) => (b.id || 0) - (a.id || 0)));
    setCounts({ participants: participants.length, redemptions: redemptions.length, audits: audits.length });
  };

  useEffect(() => {
    refresh();
  }, [sync.lastSync, sync.running]);

  if (loading || !ready) {
    return (
      <AppShell role={role || "buffet"}>
        <PageLoading label="Checking sync" />
      </AppShell>
    );
  }

  const myDevice = getDeviceId();

  return (
    <AppShell role={role} conferenceName={conference.name}>
      <div className="mx-auto w-full max-w-2xl">
        <PageHeader
          eyebrow={conference.name}
          title="Synchronisation"
          description="Registrations and buffet entries move between phones through the shared conference database."
          actions={
            <button
              onClick={() => runSync("manual")}
              disabled={sync.running}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
            >
              {sync.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Sync now
            </button>
          }
        />

        <div
          className={cn(
            "rounded-2xl border p-4",
            sync.online ? "border-border/70 bg-card" : "border-warning/30 bg-warning/5"
          )}
        >
          <div className="flex items-center gap-2">
            {sync.online ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <CloudOff className="h-4 w-4 text-warning" />
            )}
            <p className="text-sm font-medium">
              {sync.online
                ? sync.running
                  ? "Syncing…"
                  : `Last successful sync ${relativeTime(sync.lastSync)}`
                : "Offline — everything is saved on this phone"}
            </p>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {sync.lastSync ? formatNPT(sync.lastSync) : "No sync has completed on this device yet."}
          </p>
          {sync.error ? (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {sync.error}
            </p>
          ) : null}
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Metric label="Pending upload" value={sync.pending} />
            <Metric label="Failed" value={sync.failed} tone={sync.failed ? "text-destructive" : ""} />
            <Metric label="Participants" value={counts.participants} />
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-border/70 bg-card p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Waiting to upload
          </p>
          <div className="mt-2 divide-y divide-border/60">
            {outbox.slice(0, 12).map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-2 py-2 text-xs">
                <div className="min-w-0">
                  <p className="font-medium">{KIND_LABELS[item.kind] || item.kind}</p>
                  <p className="mono truncate text-[10px] text-muted-foreground">
                    {item.payload?.participant_id || item.payload?.transaction_id || item.payload?.token || item.payload?.key || ""}
                  </p>
                  {item.last_error ? (
                    <p className="text-[10px] text-destructive">{item.last_error}</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {item.attempts ? `${item.attempts} retries` : "queued"}
                </span>
              </div>
            ))}
            {!outbox.length ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                Everything is uploaded.
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-border/70 bg-card p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Devices</p>
          <div className="mt-2 space-y-2">
            {(sync.devices || []).map((d) => (
              <div key={d.device_id} className="flex items-center gap-2.5 rounded-xl bg-muted/50 px-3 py-2.5">
                <Smartphone className="h-4 w-4 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    {d.name} {d.device_id === myDevice ? "(this phone)" : ""}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {d.role} · {d.participants_count} records · pulled {relativeTime(d.last_pull_at)}
                  </p>
                </div>
              </div>
            ))}
            {!(sync.devices || []).length ? (
              <p className="py-3 text-center text-xs text-muted-foreground">
                No other devices have reported yet.
              </p>
            ) : null}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            A newly registered pass only works at the buffet once the scanner phone has pulled the record.
            The registration screen shows that state for every new participant.
          </p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <Metric label="Buffet entries" value={counts.redemptions} />
          <Metric label="Audit events" value={counts.audits} />
        </div>
      </div>
    </AppShell>
  );
}

function Metric({ label, value, tone = "" }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background px-2 py-2">
      <p className={cn("num font-heading text-lg font-semibold", tone)}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}