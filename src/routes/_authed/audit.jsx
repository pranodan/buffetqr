import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import AppShell from "@/components/AppShell";
import NoAccess from "@/components/NoAccess";
import PageLoading from "@/components/PageLoading";
import PageHeader from "@/components/PageHeader";
import { useAppSession } from "@/hooks/useAppSession";
import { useConference } from "@/hooks/useConference";
import { dbAll } from "@/lib/db";
import { formatNPT } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/audit")({
  head: () => ({ meta: [{ title: "Audit log · Buffet Access" }] }),
  component: AuditPage,
});

const FILTERS = [
  { id: "all", label: "All events" },
  { id: "REDEMPTION_GRANTED", label: "Grants" },
  { id: "SCAN_DUPLICATE", label: "Duplicates" },
  { id: "SCAN_INVALID", label: "Invalid" },
  { id: "MANUAL_EXCEPTION", label: "Exceptions" },
  { id: "SPOT_REGISTRATION", label: "Spot registrations" },
  { id: "PARTICIPANT_IMPORT", label: "Imports" },
];

function AuditPage() {
  const { role, loading } = useAppSession();
  const { conference, ready } = useConference();
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(60);

  useEffect(() => {
    dbAll("audits").then((rows) =>
      setEvents(rows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)))
    );
  }, []);

  const filtered = useMemo(
    () => (filter === "all" ? events : events.filter((e) => e.event_type === filter)),
    [events, filter]
  );

  if (loading || !ready) {
    return (
      <AppShell role={role || "admin"}>
        <PageLoading label="Loading audit log" />
      </AppShell>
    );
  }
  if (role !== "admin") {
    return (
      <AppShell role={role} conferenceName={conference.name}>
        <NoAccess role={role} />
      </AppShell>
    );
  }

  return (
    <AppShell role={role} conferenceName={conference.name}>
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader
          eyebrow={conference.name}
          title="Audit log"
          description={`${events.length} events recorded on this phone. Entries cannot be edited.`}
        />

        <div className="hide-scrollbar flex gap-1.5 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium",
                filter === f.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/70 bg-card text-muted-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card">
          {filtered.slice(0, limit).map((e) => (
            <div key={e.event_id} className="flex items-start gap-3 px-3.5 py-3">
              <span
                className={cn(
                  "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full",
                  e.outcome === "GRANTED" || e.outcome === "SUCCESS"
                    ? "bg-success/10 text-success"
                    : "bg-destructive/10 text-destructive"
                )}
              >
                <ScrollText className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{e.event_type.replace(/_/g, " ").toLowerCase()}</p>
                <p className="mono truncate text-[10px] text-muted-foreground">
                  {e.participant_id || "—"} {e.session ? `· ${e.session}` : ""}
                </p>
                {e.reason ? <p className="text-[11px] text-muted-foreground">{e.reason}</p> : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] text-muted-foreground">{formatNPT(e.timestamp)}</p>
                <p className="text-[10px] text-muted-foreground/70">{e.device_id}</p>
              </div>
            </div>
          ))}
          {!filtered.length ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">No events for this filter.</p>
          ) : null}
        </div>

        {filtered.length > limit ? (
          <button
            onClick={() => setLimit((l) => l + 60)}
            className="mt-3 w-full rounded-xl border border-border bg-card py-2.5 text-xs font-medium"
          >
            Show more
          </button>
        ) : null}
      </div>
    </AppShell>
  );
}