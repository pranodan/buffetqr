import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FileUp, Download, AlertTriangle, CheckCircle2, Loader2, ArrowLeft } from "lucide-react";
import AppShell from "@/components/AppShell";
import NoAccess from "@/components/NoAccess";
import PageLoading from "@/components/PageLoading";
import PageHeader from "@/components/PageHeader";
import { useAppSession } from "@/hooks/useAppSession";
import { useConference } from "@/hooks/useConference";
import { allParticipants } from "@/lib/participants";
import { REQUIRED_HEADERS, applyImport, importTemplate, validateImport } from "@/lib/importer";
import { downloadText, parseCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/import")({
  head: () => ({ meta: [{ title: "Import participants · Buffet Access" }] }),
  component: ImportPage,
});

function ImportPage() {
  const { user, role, loading } = useAppSession();
  const { conference, ready } = useConference();
  const actor = user?.full_name || user?.email || "Admin";

  const [rows, setRows] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const onFile = async (event) => {
    setError("");
    setDone(null);
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { headers, records } = parseCsv(text);
      const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
      if (missing.length) {
        setRows(null);
        setSummary(null);
        setError(`This file is missing required columns: ${missing.join(", ")}`);
        return;
      }
      if (!records.length) {
        setRows(null);
        setSummary(null);
        setError("No participant rows found in that file.");
        return;
      }
      const existing = await allParticipants();
      const result = validateImport(records, existing);
      setRows(result.rows);
      setSummary(result.summary);
    } catch (err) {
      setError(String(err?.message || err));
    }
  };

  const confirm = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const result = await applyImport(rows, actor);
      setDone(result);
      setRows(null);
      setSummary(null);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  if (loading || !ready) {
    return (
      <AppShell role={role || "admin"}>
        <PageLoading label="Opening import" />
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

  const validRows = rows ? rows.filter((r) => !r.errors.length) : [];
  const previewRows = rows ? rows.slice(0, 30) : [];

  return (
    <AppShell role={role} conferenceName={conference.name}>
      <div className="mx-auto w-full max-w-4xl">
        <PageHeader
          eyebrow={conference.name}
          title="Import participant list"
          description="CSV or Excel-exported CSV. Existing passes and redemptions are never overwritten."
          actions={
            <button
              onClick={() => downloadText("participant-import-template.csv", importTemplate())}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium"
            >
              <Download className="h-3.5 w-3.5" /> Template
            </button>
          }
        />

        {done ? (
          <div className="rounded-2xl border border-success/25 bg-success/5 p-5">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="h-5 w-5" />
              <p className="font-heading text-sm font-semibold">Import complete</p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {done.created} new participants added, {done.updated} existing records updated. QR passes were
              generated for new participants and upload is running in the background.
            </p>
            <button
              onClick={() => setDone(null)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-medium text-primary-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Import another file
            </button>
          </div>
        ) : (
          <>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center transition-colors hover:border-primary/40">
              <FileUp className="h-6 w-6 text-primary" />
              <span className="font-heading text-sm font-semibold">Choose CSV file</span>
              <span className="text-[11px] text-muted-foreground">
                Required columns: participant_id, full_name, category, institution, day1_eligible, day2_eligible
              </span>
              <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
            </label>

            {error ? (
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-destructive/8 px-3 py-2.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
              </p>
            ) : null}

            {summary ? (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Chip label="Rows" value={summary.total} />
                  <Chip label="New" value={summary.create} tone="success" />
                  <Chip label="Updates" value={summary.update} tone="primary" />
                  <Chip label="With errors" value={summary.errors} tone={summary.errors ? "danger" : "muted"} />
                </div>

                <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
                  <div className="max-h-96 overflow-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-muted/80 text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur">
                        <tr>
                          <th className="px-3 py-2">Line</th>
                          <th className="px-3 py-2">ID</th>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Day 1</th>
                          <th className="px-3 py-2">Day 2</th>
                          <th className="px-3 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {previewRows.map((r) => (
                          <tr key={`${r.line}-${r.participant_id}`} className={r.errors.length ? "bg-destructive/5" : ""}>
                            <td className="px-3 py-2 text-muted-foreground">{r.line}</td>
                            <td className="mono px-3 py-2">{r.participant_id || "—"}</td>
                            <td className="px-3 py-2">{r.full_name || "—"}</td>
                            <td className="px-3 py-2">{r.day1_eligible ? "yes" : "no"}</td>
                            <td className="px-3 py-2">{r.day2_eligible ? "yes" : "no"}</td>
                            <td className="px-3 py-2">
                              {r.errors.length ? (
                                <span className="text-destructive">{r.errors.join("; ")}</span>
                              ) : r.warnings.length ? (
                                <span className="text-warning">{r.warnings.join("; ")}</span>
                              ) : r.action === "update" ? (
                                <span className="text-primary">update existing</span>
                              ) : (
                                <span className="text-success">new</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.length > previewRows.length ? (
                    <p className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
                      Showing first {previewRows.length} of {rows.length} rows.
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={confirm}
                    disabled={busy || !validRows.length}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                    Import {validRows.length} participants
                  </button>
                  <button
                    onClick={() => {
                      setRows(null);
                      setSummary(null);
                    }}
                    className="rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium"
                  >
                    Cancel
                  </button>
                  {summary.errors ? (
                    <p className="text-[11px] text-muted-foreground">
                      Rows with errors are skipped. Fix them in the file and import again.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}

function Chip({ label, value, tone = "muted" }) {
  const tones = {
    success: "text-success",
    primary: "text-primary",
    danger: "text-destructive",
    muted: "text-foreground",
  };
  return (
    <div className="rounded-xl border border-border/70 bg-card px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("num font-heading text-lg font-semibold", tones[tone])}>{value}</p>
    </div>
  );
}