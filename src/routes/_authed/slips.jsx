import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Printer, Download, Loader2, Search, CheckSquare, Square } from "lucide-react";
import AppShell from "@/components/AppShell";
import NoAccess from "@/components/NoAccess";
import PageLoading from "@/components/PageLoading";
import PageHeader from "@/components/PageHeader";
import SlipSheets, { pageCount } from "@/components/slips/SlipSheets";
import { useAppSession } from "@/hooks/useAppSession";
import { useConference } from "@/hooks/useConference";
import { allParticipants } from "@/lib/participants";
import { qrDataUrl } from "@/lib/qr";
import { downloadSlipPdf } from "@/lib/pdf";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/slips")({
  head: () => ({ meta: [{ title: "QR slips · Buffet Access" }] }),
  component: SlipsPage,
});

function SlipsPage() {
  const { role, loading } = useAppSession();
  const { conference, ready } = useConference();

  const [list, setList] = useState([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("name");
  const [excluded, setExcluded] = useState(() => new Set());
  const [qrMap, setQrMap] = useState({});
  const [building, setBuilding] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const generatedRef = useRef(new Set());
  const sheetsRef = useRef(null);

  useEffect(() => {
    allParticipants().then(setList);
  }, []);

  const categories = useMemo(
    () => Array.from(new Set(list.map((p) => p.category).filter(Boolean))).sort(),
    [list]
  );

  const effective = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list
      .filter((p) => {
        if (p.token_status !== "ACTIVE") return false;
        if (excluded.has(p.participant_id)) return false;
        if (category !== "all" && (p.category || "") !== category) return false;
        if (q && !`${p.full_name} ${p.participant_id}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) =>
        sort === "id"
          ? a.participant_id.localeCompare(b.participant_id)
          : a.full_name.localeCompare(b.full_name)
      );
  }, [list, query, category, sort, excluded]);

  const effectiveKey = effective.map((p) => p.participant_id).join(",");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = effective.filter((p) => !generatedRef.current.has(p.participant_id));
      if (!pending.length) return;
      setBuilding(true);
      const entries = [];
      for (const p of pending) {
        if (cancelled) return;
        const url = await qrDataUrl(p.qr_token, 420);
        generatedRef.current.add(p.participant_id);
        entries.push([p.participant_id, url]);
      }
      if (cancelled) return;
      setQrMap((prev) => {
        const next = { ...prev };
        entries.forEach(([key, value]) => {
          next[key] = value;
        });
        return next;
      });
      setBuilding(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveKey]);

  const items = effective.map((p) => ({
    key: p.participant_id,
    name: p.full_name,
    id: p.participant_id,
    category: p.category,
    institution: p.institution,
  }));

  const toggle = (id) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const downloadPdf = async () => {
    if (!sheetsRef.current) return;
    setPdfBusy(true);
    try {
      await downloadSlipPdf(sheetsRef.current, `qr-slips-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      setPdfBusy(false);
    }
  };

  if (loading || !ready) {
    return (
      <AppShell role={role || "admin"}>
        <PageLoading label="Preparing slips" />
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
      <div className="mx-auto w-full max-w-4xl">
        <div className="no-print">
          <PageHeader
            eyebrow={conference.name}
            title="QR slips"
            description="Six slips per A4 page, 2 columns by 3 rows. Print at 100% and cut on the dashed lines."
            actions={
              <>
                <button
                  onClick={() => window.print()}
                  disabled={building || !items.length}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  <Printer className="h-3.5 w-3.5" /> Print
                </button>
                <button
                  onClick={downloadPdf}
                  disabled={building || pdfBusy || !items.length}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 text-xs font-medium disabled:opacity-50"
                >
                  {pdfBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  {pdfBusy ? "Building PDF" : "Download PDF"}
                </button>
              </>
            }
          />

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="relative sm:col-span-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or ID"
                className="w-full rounded-xl border border-input bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary"
              />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm outline-none focus:border-primary"
            >
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm outline-none focus:border-primary"
            >
              <option value="name">Sort by name</option>
              <option value="id">Sort by registration ID</option>
            </select>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-card px-3.5 py-2.5 text-xs">
            <p className="text-muted-foreground">
              <span className="font-semibold text-foreground">{items.length}</span> slips ·{" "}
              <span className="font-semibold text-foreground">{pageCount(items.length)}</span> A4 pages
              {building ? " · preparing codes…" : ""}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setExcluded(new Set())} className="font-medium text-primary">
                Include all
              </button>
              <button
                onClick={() => setExcluded(new Set(list.map((p) => p.participant_id)))}
                className="font-medium text-muted-foreground"
              >
                Clear
              </button>
            </div>
          </div>

          <details className="mt-3 rounded-xl border border-border/70 bg-card">
            <summary className="cursor-pointer px-3.5 py-2.5 text-xs font-medium">
              Choose who to print
            </summary>
            <div className="max-h-64 divide-y divide-border/60 overflow-y-auto border-t border-border/60">
              {list.map((p) => {
                const included = !excluded.has(p.participant_id);
                return (
                  <button
                    key={p.participant_id}
                    onClick={() => toggle(p.participant_id)}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs"
                  >
                    {included ? (
                      <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Square className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{p.full_name}</span>
                    <span className="mono shrink-0 text-[10px] text-muted-foreground">{p.participant_id}</span>
                    {p.token_status !== "ACTIVE" ? (
                      <span className="shrink-0 text-[10px] uppercase text-destructive">revoked</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </details>
        </div>

        <div className="mt-6 overflow-x-auto">
          <div ref={sheetsRef} className={cn("w-[194mm] min-w-[194mm]", !items.length && "hidden")}>
            <SlipSheets items={items} qrMap={qrMap} />
          </div>
        </div>

        {!items.length ? (
          <p className="no-print py-10 text-center text-sm text-muted-foreground">
            No slips selected. Adjust the filters above.
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}