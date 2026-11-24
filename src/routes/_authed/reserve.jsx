import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Ticket, Printer, Loader2, Plus, Search, Download } from "lucide-react";
import AppShell from "@/components/AppShell";
import NoAccess from "@/components/NoAccess";
import PageLoading from "@/components/PageLoading";
import PageHeader from "@/components/PageHeader";
import SlipSheets from "@/components/slips/SlipSheets";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAppSession } from "@/hooks/useAppSession";
import { useConference } from "@/hooks/useConference";
import { allTokens, assignReserveToken, generateReserveTokens } from "@/lib/reserve";
import { allParticipants } from "@/lib/participants";
import { qrDataUrl } from "@/lib/qr";
import { downloadSlipPdf } from "@/lib/pdf";
import { formatNPT } from "@/lib/format";
import { runSync } from "@/lib/sync";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/reserve")({
  head: () => ({ meta: [{ title: "Reserve passes · Buffet Access" }] }),
  component: ReservePage,
});

const PRESETS = [10, 20, 50];

function ReservePage() {
  const { user, role, loading } = useAppSession();
  const { conference, ready } = useConference();
  const actor = user?.full_name || user?.email || "Admin";

  const [tokens, setTokens] = useState([]);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [qrMap, setQrMap] = useState({});
  const [showSheets, setShowSheets] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [assigning, setAssigning] = useState(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);

  const load = async () => setTokens(await allTokens());
  useEffect(() => {
    load();
  }, []);

  const unused = tokens.filter((t) => t.status === "UNUSED");

  const generate = async (count) => {
    if (!count || count < 1) return;
    setBusy(true);
    try {
      await generateReserveTokens(count, actor);
      await load();
      runSync("reserve-generated");
    } finally {
      setBusy(false);
    }
  };

  const prepareSheets = async () => {
    setBusy(true);
    try {
      const next = { ...qrMap };
      for (const t of unused) {
        if (!next[t.token]) next[t.token] = await qrDataUrl(t.token, 420);
      }
      setQrMap(next);
      setShowSheets(true);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!assigning) return;
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
  }, [search, assigning]);

  const assign = async (participant) => {
    setBusy(true);
    try {
      await assignReserveToken(assigning.token, participant.participant_id, actor);
      setAssigning(null);
      setSearch("");
      await load();
      runSync("reserve-assigned");
    } finally {
      setBusy(false);
    }
  };

  if (loading || !ready) {
    return (
      <AppShell role={role || "admin"}>
        <PageLoading label="Loading reserve passes" />
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

  const sheetItems = unused.map((t) => ({
    key: t.token,
    name: "Reserve buffet pass",
    id: t.token,
    category: `Batch ${t.batch || "—"}`,
    institution: "Assigned at Registration desk",
  }));

  return (
    <AppShell role={role} conferenceName={conference.name}>
      <div className="mx-auto w-full max-w-4xl">
        <div className="no-print">
          <PageHeader
            eyebrow={conference.name}
            title="Reserve passes"
            description="Pre-printed passes for walk-ins. A reserve pass only works once it is linked to a participant."
          />

          <div className="rounded-2xl border border-border/70 bg-card p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Generate a new batch
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {PRESETS.map((n) => (
                <button
                  key={n}
                  onClick={() => generate(n)}
                  disabled={busy}
                  className="rounded-xl border border-border bg-background px-3.5 py-2 text-xs font-medium disabled:opacity-50"
                >
                  +{n}
                </button>
              ))}
              <div className="flex items-center gap-1.5">
                <input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="Custom"
                  inputMode="numeric"
                  className="w-20 rounded-xl border border-input bg-background px-2.5 py-2 text-xs outline-none focus:border-primary"
                />
                <button
                  onClick={() => {
                    generate(Number(custom));
                    setCustom("");
                  }}
                  disabled={busy || !custom}
                  className="inline-flex items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Create
                </button>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {unused.length} unused · {tokens.filter((t) => t.status === "ASSIGNED").length} assigned ·{" "}
              {tokens.filter((t) => t.status === "REVOKED").length} revoked
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={prepareSheets}
              disabled={busy || !unused.length}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              <Printer className="h-3.5 w-3.5" /> Prepare reserve slips
            </button>
            {showSheets ? (
              <>
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 text-xs font-medium"
                >
                  <Printer className="h-3.5 w-3.5" /> Print
                </button>
                <button
                  onClick={async () => {
                    setPdfBusy(true);
                    try {
                      await downloadSlipPdf(document.getElementById("reserve-sheets"), "reserve-slips.pdf");
                    } finally {
                      setPdfBusy(false);
                    }
                  }}
                  disabled={pdfBusy}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 text-xs font-medium disabled:opacity-50"
                >
                  {pdfBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  PDF
                </button>
              </>
            ) : null}
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-border/70 bg-card">
            <div className="max-h-96 divide-y divide-border/60 overflow-y-auto">
              {tokens.map((t) => (
                <div key={t.token} className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="mono truncate text-[11px]">{t.token}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {t.status === "ASSIGNED"
                        ? `${t.assigned_participant_id} · ${formatNPT(t.assigned_at)}`
                        : `Batch ${t.batch || "—"}`}
                    </p>
                  </div>
                  {t.status === "UNUSED" ? (
                    <button
                      onClick={() => setAssigning(t)}
                      className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium"
                    >
                      Assign
                    </button>
                  ) : (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        t.status === "ASSIGNED" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                      )}
                    >
                      {t.status.toLowerCase()}
                    </span>
                  )}
                </div>
              ))}
              {!tokens.length ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No reserve passes yet.
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {showSheets && sheetItems.length ? (
          <div className="mt-6 overflow-x-auto">
            <div id="reserve-sheets" className="w-[194mm] min-w-[194mm]">
              <SlipSheets items={sheetItems} qrMap={qrMap} showId={false} showCategory={false} />
            </div>
          </div>
        ) : null}
      </div>

      <Sheet open={!!assigning} onOpenChange={(open) => !open && setAssigning(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl pb-8">
          <SheetHeader className="text-left">
            <SheetTitle className="font-heading text-base">Assign reserve pass</SheetTitle>
          </SheetHeader>
          <p className="mono mt-1 text-[11px] text-muted-foreground">{assigning?.token}</p>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search participant by name or ID"
              className="w-full rounded-xl border border-input bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="mt-2 divide-y divide-border/60">
            {results.map((p) => (
              <button
                key={p.participant_id}
                onClick={() => assign(p)}
                disabled={busy}
                className="flex w-full items-center gap-2 px-1 py-2.5 text-left text-xs disabled:opacity-50"
              >
                <Ticket className="h-3.5 w-3.5 text-primary" />
                <span className="min-w-0 flex-1 truncate">{p.full_name}</span>
                <span className="mono shrink-0 text-[10px] text-muted-foreground">{p.participant_id}</span>
              </button>
            ))}
            {search.length > 1 && !results.length ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No participant found.</p>
            ) : null}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            An assigned pass stays linked to that person permanently, even if the registration is later
            cancelled.
          </p>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}