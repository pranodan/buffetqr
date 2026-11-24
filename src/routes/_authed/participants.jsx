import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, Printer, RefreshCw, Trash2, Ban, ShieldCheck, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import NoAccess from "@/components/NoAccess";
import PageLoading from "@/components/PageLoading";
import PageHeader from "@/components/PageHeader";
import SyncBadge from "@/components/SyncBadge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAppSession } from "@/hooks/useAppSession";
import { useConference } from "@/hooks/useConference";
import { allParticipants, deleteParticipant, replaceToken, revokeToken, updateParticipant } from "@/lib/participants";
import { qrDataUrl } from "@/lib/qr";
import { printSingleSlip } from "@/lib/slipPrint";
import { formatNPT } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/participants")({
  head: () => ({ meta: [{ title: "Participants · Buffet Access" }] }),
  component: ParticipantsPage,
});

const FILTERS = [
  { id: "all", label: "All" },
  { id: "day1", label: "Day 1 pending" },
  { id: "day2", label: "Day 2 pending" },
  { id: "spot", label: "Spot" },
  { id: "revoked", label: "Revoked" },
];

function ParticipantsPage() {
  const { user, role, loading } = useAppSession();
  const { conference, ready } = useConference();
  const actor = user?.full_name || user?.email || "Admin";

  const [list, setList] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [qr, setQr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [limit, setLimit] = useState(40);

  useEffect(() => {
    allParticipants().then((rows) =>
      setList(rows.sort((a, b) => a.full_name.localeCompare(b.full_name)))
    );
  }, [reloadKey]);

  useEffect(() => {
    if (!selected) {
      setQr(null);
      return;
    }
    qrDataUrl(selected.qr_token, 420).then(setQr);
  }, [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((p) => {
      if (q) {
        const haystack = `${p.full_name} ${p.participant_id} ${p.institution || ""} ${p.category || ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filter === "day1") return p.day1_eligible && !p.day1_redeemed && p.token_status === "ACTIVE";
      if (filter === "day2") return p.day2_eligible && !p.day2_redeemed && p.token_status === "ACTIVE";
      if (filter === "spot") return p.registration_source === "SPOT_REGISTERED";
      if (filter === "revoked") return p.token_status === "REVOKED";
      return true;
    });
  }, [list, query, filter]);

  const refresh = async (id) => {
    const rows = await allParticipants();
    setList(rows.sort((a, b) => a.full_name.localeCompare(b.full_name)));
    if (id) setSelected(rows.find((r) => r.participant_id === id) || null);
    setReloadKey((k) => k + 1);
  };

  const act = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await refresh(selected?.participant_id);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !ready) {
    return (
      <AppShell role={role || "registration"}>
        <PageLoading label="Loading participants" />
      </AppShell>
    );
  }
  if (!["admin", "registration"].includes(role)) {
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
          title="Participants"
          description={`${list.length} records on this phone`}
          actions={
            <button
              onClick={() => refresh()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          }
        />

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, ID or institution"
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>

        <div className="hide-scrollbar mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
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
          {filtered.slice(0, limit).map((p) => (
            <button
              key={p.participant_id}
              onClick={() => setSelected(p)}
              className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/50"
            >
              <div className="min-w-0">
                <p className="truncate font-heading text-sm font-semibold">{p.full_name}</p>
                <p className="mono truncate text-[11px] text-muted-foreground">
                  {p.participant_id} · {p.category || "Participant"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <DayPip label="D1" on={p.day1_eligible} done={p.day1_redeemed} />
                <DayPip label="D2" on={p.day2_eligible} done={p.day2_redeemed} />
              </div>
            </button>
          ))}
          {!filtered.length ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">No matching participants.</p>
          ) : null}
        </div>

        {filtered.length > limit ? (
          <button
            onClick={() => setLimit((l) => l + 40)}
            className="mt-3 w-full rounded-xl border border-border bg-card py-2.5 text-xs font-medium"
          >
            Show more ({filtered.length - limit} left)
          </button>
        ) : null}
      </div>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-3xl pb-8">
          {selected ? (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="font-heading text-lg">{selected.full_name}</SheetTitle>
                <p className="mono text-xs text-muted-foreground">{selected.participant_id}</p>
              </SheetHeader>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <SyncBadge state={selected.token_status} />
                <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                  {selected.registration_source?.replace("_", " ").toLowerCase()}
                </span>
                <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                  Registered {formatNPT(selected.registration_timestamp)}
                </span>
              </div>

              <div className="mt-4 flex gap-4">
                {qr ? (
                  <img
                    src={qr}
                    alt="QR"
                    className="h-28 w-28 shrink-0 rounded-xl border border-black/10 bg-white p-1.5"
                  />
                ) : null}
                <div className="min-w-0 space-y-1 text-xs text-muted-foreground">
                  <p>{selected.category || "Participant"}</p>
                  {selected.institution ? <p>{selected.institution}</p> : null}
                  {selected.designation ? <p>{selected.designation}</p> : null}
                  {selected.phone ? <p>{selected.phone}</p> : null}
                  {selected.email ? <p className="truncate">{selected.email}</p> : null}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <EligibilityRow
                  label="Day 1"
                  eligible={selected.day1_eligible}
                  redeemed={selected.day1_redeemed}
                  redeemedAt={selected.day1_redeemed_at}
                  disabled={role !== "admin" || busy}
                  onToggle={() =>
                    act(() =>
                      updateParticipant(
                        selected.participant_id,
                        { day1_eligible: !selected.day1_eligible },
                        actor
                      )
                    )
                  }
                />
                <EligibilityRow
                  label="Day 2"
                  eligible={selected.day2_eligible}
                  redeemed={selected.day2_redeemed}
                  redeemedAt={selected.day2_redeemed_at}
                  disabled={role !== "admin" || busy}
                  onToggle={() =>
                    act(() =>
                      updateParticipant(
                        selected.participant_id,
                        { day2_eligible: !selected.day2_eligible },
                        actor
                      )
                    )
                  }
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    printSingleSlip({
                      name: selected.full_name,
                      id: selected.participant_id,
                      category: selected.category,
                      institution: selected.institution,
                      qr,
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 text-xs font-medium"
                >
                  <Printer className="h-3.5 w-3.5" /> Print slip
                </button>
                {role === "admin" ? (
                  <>
                    <button
                      onClick={() => act(() => replaceToken(selected.participant_id, actor))}
                      disabled={busy}
                      className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 text-xs font-medium disabled:opacity-50"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Replace QR
                    </button>
                    <button
                      onClick={() => act(() => revokeToken(selected.participant_id, actor, "Revoked by admin"))}
                      disabled={busy || selected.token_status === "REVOKED"}
                      className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 text-xs font-medium disabled:opacity-50"
                    >
                      <Ban className="h-3.5 w-3.5" /> Revoke pass
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm(`Delete ${selected.full_name}? Redemption history is kept.`)) return;
                        await deleteParticipant(selected.participant_id, actor);
                        setSelected(null);
                        refresh();
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-destructive/30 px-3.5 py-2.5 text-xs font-medium text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </>
                ) : null}
                <button
                  onClick={() => setSelected(null)}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 text-xs font-medium"
                >
                  <X className="h-3.5 w-3.5" /> Close
                </button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}

function DayPip({ label, on, done }) {
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-1 text-[10px] font-semibold",
        !on
          ? "bg-muted text-muted-foreground/60"
          : done
            ? "bg-success/12 text-success"
            : "bg-primary/10 text-primary"
      )}
    >
      {label}
    </span>
  );
}

function EligibilityRow({ label, eligible, redeemed, redeemedAt, onToggle, disabled }) {
  return (
    <div className="rounded-xl border border-border/70 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">{label}</p>
        <button
          onClick={onToggle}
          disabled={disabled}
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
            eligible ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
            disabled && "opacity-60"
          )}
        >
          {eligible ? "Eligible" : "Not eligible"}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {redeemed ? `Redeemed ${formatNPT(redeemedAt)}` : "Not redeemed"}
      </p>
    </div>
  );
}