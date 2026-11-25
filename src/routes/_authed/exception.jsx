import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldAlert, Search, Loader2, CheckCircle2, XCircle } from "lucide-react";
import AppShell from "@/components/AppShell";
import NoAccess from "@/components/NoAccess";
import PageLoading from "@/components/PageLoading";
import PageHeader from "@/components/PageHeader";
import { useAppSession } from "@/hooks/useAppSession";
import { useConference } from "@/hooks/useConference";
import { allParticipants } from "@/lib/participants";
import { commitManualException } from "@/lib/redemption";
import { sessionLabel } from "@/lib/settings";
import { formatNPT } from "@/lib/format";
import { runSync } from "@/lib/sync";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/exception")({
  head: () => ({ meta: [{ title: "Manual exception · Buffet Access" }] }),
  component: ExceptionPage,
});

function ExceptionPage() {
  const { user, role, loading } = useAppSession();
  const { conference, ready } = useConference();
  const actor = user?.full_name || user?.email || "Admin";

  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [session, setSession] = useState("day1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (conference.active_session) setSession(conference.active_session);
  }, [conference.active_session]);

  useEffect(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    allParticipants().then((rows) =>
      setResults(
        rows
          .filter((p) => `${p.full_name} ${p.participant_id}`.toLowerCase().includes(q))
          .slice(0, 8)
      )
    );
  }, [search]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setOutcome(null);
    if (!selected) {
      setError("Choose a participant first.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setBusy(true);
    try {
      const result = await commitManualException({ participant: selected, session, reason, actor });
      setOutcome(result);
      if (result.status === "GRANTED") {
        setReason("");
        runSync("manual-exception");
        const rows = await allParticipants();
        setSelected(rows.find((r) => r.participant_id === selected.participant_id) || selected);
      }
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  if (loading || !ready) {
    return (
      <AppShell role={role || "admin"}>
        <PageLoading label="Opening exceptions" />
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
      <div className="mx-auto w-full max-w-xl">
        <PageHeader
          eyebrow={conference.name}
          title="Manual exception"
          description="Contingency entry when a pass cannot be scanned. Duplicate rules still apply."
        />

        <form onSubmit={submit} className="space-y-3">
          <div className="rounded-2xl border border-border/70 bg-card p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              1. Find the participant
            </p>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelected(null);
                  setOutcome(null);
                }}
                placeholder="Name or registration ID"
                className="w-full rounded-xl border border-input bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary"
              />
            </div>
            {results.length ? (
              <div className="mt-2 divide-y divide-border/60">
                {results.map((p) => (
                  <button
                    key={p.participant_id}
                    type="button"
                    onClick={() => {
                      setSelected(p);
                      setSearch(p.full_name.toUpperCase());
                      setResults([]);
                    }}
                    className="flex w-full items-center gap-2 px-1 py-2.5 text-left text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate uppercase">{p.full_name}</span>
                    <span className="mono shrink-0 text-[10px] text-muted-foreground">{p.participant_id}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {selected ? (
              <div className="mt-3 rounded-xl bg-muted/60 p-3">
                <p className="font-heading text-sm font-semibold uppercase">{selected.full_name}</p>
                <p className="mono text-[11px] text-muted-foreground">{selected.participant_id}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <p>
                    Day 1:{" "}
                    <span className={selected.day1_eligible ? "text-primary" : "text-muted-foreground"}>
                      {selected.day1_eligible ? "eligible" : "not eligible"}
                    </span>
                    {selected.day1_redeemed ? " · redeemed" : ""}
                  </p>
                  <p>
                    Day 2:{" "}
                    <span className={selected.day2_eligible ? "text-primary" : "text-muted-foreground"}>
                      {selected.day2_eligible ? "eligible" : "not eligible"}
                    </span>
                    {selected.day2_redeemed ? " · redeemed" : ""}
                  </p>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Confirm the printed name card matches before continuing.
                </p>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-border/70 bg-card p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              2. Session and reason
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {["day1", "day2"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSession(s)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-xs font-medium",
                    session === s
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground"
                  )}
                >
                  {sessionLabel(conference, s)}
                </button>
              ))}
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Reason, e.g. pass torn, scanner camera failed, pass not yet synced"
              className="mt-2 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
            {error ? (
              <p className="mt-2 rounded-lg bg-destructive/8 px-3 py-2 text-xs text-destructive">{error}</p>
            ) : null}
            <button
              type="submit"
              disabled={busy || !selected}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
              Record manual entry
            </button>
          </div>
        </form>

        {outcome ? (
          <div
            className={cn(
              "mt-3 rounded-2xl border p-4 text-sm",
              outcome.status === "GRANTED"
                ? "border-success/25 bg-success/5 text-success"
                : "border-destructive/25 bg-destructive/5 text-destructive"
            )}
          >
            <div className="flex items-center gap-2 font-medium">
              {outcome.status === "GRANTED" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              {outcome.status === "GRANTED"
                ? "Manual entry recorded"
                : outcome.status === "DUPLICATE"
                  ? "Already redeemed this session"
                  : outcome.status === "NOT_ELIGIBLE"
                    ? "Not eligible for this session"
                    : "Could not record the entry"}
            </div>
            {outcome.status === "GRANTED" && outcome.redemption ? (
              <p className="mt-1 text-xs text-foreground/70">
                {formatNPT(outcome.redemption.timestamp)} · saved on this phone and queued for sync.
              </p>
            ) : null}
            {outcome.status === "DUPLICATE" && outcome.existing ? (
              <p className="mt-1 text-xs text-foreground/70">
                Previous entry {formatNPT(outcome.existing.timestamp)}.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}