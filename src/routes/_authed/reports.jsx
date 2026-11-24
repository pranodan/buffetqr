import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, FileJson, Upload, AlertTriangle } from "lucide-react";
import AppShell from "@/components/AppShell";
import NoAccess from "@/components/NoAccess";
import PageLoading from "@/components/PageLoading";
import PageHeader from "@/components/PageHeader";
import { useAppSession } from "@/hooks/useAppSession";
import { useConference } from "@/hooks/useConference";
import { computeStats } from "@/lib/stats";
import { downloadText, toCsv } from "@/lib/csv";
import { buildBackup, restoreBackup, summariseBackup } from "@/lib/backup";
import { pct } from "@/lib/format";
import { runSync } from "@/lib/sync";

export const Route = createFileRoute("/_authed/reports")({
  head: () => ({ meta: [{ title: "Reports · Buffet Access" }] }),
  component: ReportsPage,
});

const DAY = () => new Date().toISOString().slice(0, 10);

function ReportsPage() {
  const { role, loading } = useAppSession();
  const { conference, ready } = useConference();
  const [stats, setStats] = useState(null);
  const [restorePreview, setRestorePreview] = useState(null);
  const [restorePayload, setRestorePayload] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    computeStats().then(setStats);
  }, []);

  const exportParticipants = async () => {
    const rows = (stats?.participants || []).map((p) => ({
      participant_id: p.participant_id,
      full_name: p.full_name,
      category: p.category,
      institution: p.institution,
      designation: p.designation,
      email: p.email,
      phone: p.phone,
      day1_eligible: p.day1_eligible,
      day2_eligible: p.day2_eligible,
      day1_redeemed: p.day1_redeemed,
      day2_redeemed: p.day2_redeemed,
      registration_source: p.registration_source,
      registration_timestamp: p.registration_timestamp,
      token_status: p.token_status,
    }));
    downloadText(`participants-${DAY()}.csv`, toCsv(rows));
  };

  const exportRedemptions = async () => {
    const rows = (stats?.redemptions || [])
      .slice()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .map((r) => ({
        transaction_id: r.transaction_id,
        participant_id: r.participant_id,
        participant_name: r.participant_name,
        session: r.session,
        type: r.type,
        timestamp: r.timestamp,
        device_id: r.device_id,
        operator: r.operator,
        reason: r.reason,
      }));
    downloadText(`redemptions-${DAY()}.csv`, toCsv(rows));
  };

  const exportAudits = async () => {
    const rows = (stats?.audits || [])
      .slice()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .map((a) => ({
        event_id: a.event_id,
        event_type: a.event_type,
        participant_id: a.participant_id,
        session: a.session,
        outcome: a.outcome,
        timestamp: a.timestamp,
        device_id: a.device_id,
        actor: a.actor,
        reason: a.reason,
        detail: a.detail,
      }));
    downloadText(`audit-log-${DAY()}.csv`, toCsv(rows));
  };

  const exportBackup = async () => {
    const payload = await buildBackup();
    downloadText(
      `buffet-backup-${DAY()}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8"
    );
  };

  const pickBackup = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage("");
    try {
      const payload = JSON.parse(await file.text());
      if (!payload || payload.app !== "buffet-access") {
        setMessage("That file is not a buffet backup.");
        return;
      }
      setRestorePayload(payload);
      setRestorePreview(summariseBackup(payload));
    } catch {
      setMessage("That file could not be read.");
    }
  };

  const confirmRestore = async () => {
    setBusy(true);
    try {
      const result = await restoreBackup(restorePayload);
      setMessage(`Restore complete: ${result.added} records added, ${result.merged} updated.`);
      setRestorePayload(null);
      setRestorePreview(null);
      setStats(await computeStats());
      runSync("after-restore");
    } finally {
      setBusy(false);
    }
  };

  if (loading || !ready) {
    return (
      <AppShell role={role || "admin"}>
        <PageLoading label="Building reports" />
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

  const s = stats || {
    counts: { total: 0, pre: 0, spot: 0, manual: 0, active: 0, revoked: 0, reserveUnused: 0 },
    sessions: {
      day1: { eligible: 0, redeemed: 0, manual: 0, duplicates: 0, invalid: 0, ineligible: 0 },
      day2: { eligible: 0, redeemed: 0, manual: 0, duplicates: 0, invalid: 0, ineligible: 0 },
    },
  };

  return (
    <AppShell role={role} conferenceName={conference.name}>
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader
          eyebrow={conference.name}
          title="Reports and backup"
          description="Everything below is read from this phone's records."
        />

        <div className="grid gap-3 sm:grid-cols-2">
          {["day1", "day2"].map((id) => {
            const b = s.sessions[id];
            return (
              <div key={id} className="rounded-2xl border border-border/70 bg-card p-4">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {id === "day1" ? conference.day1_name : conference.day2_name}
                </p>
                <p className="num mt-2 font-heading text-3xl font-semibold">
                  {b.redeemed}
                  <span className="text-base font-normal text-muted-foreground"> / {b.eligible}</span>
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct(b.redeemed, b.eligible)}%` }} />
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
                  <div className="rounded-lg bg-muted/60 py-1.5">
                    <dt className="text-muted-foreground">Manual</dt>
                    <dd className="num font-semibold">{b.manual}</dd>
                  </div>
                  <div className="rounded-lg bg-muted/60 py-1.5">
                    <dt className="text-muted-foreground">Duplicates</dt>
                    <dd className="num font-semibold">{b.duplicates}</dd>
                  </div>
                  <div className="rounded-lg bg-muted/60 py-1.5">
                    <dt className="text-muted-foreground">Ineligible</dt>
                    <dd className="num font-semibold">{b.ineligible}</dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-2xl border border-border/70 bg-card p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Exports</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <ExportButton onClick={exportParticipants} label="Participants CSV" />
            <ExportButton onClick={exportRedemptions} label="Redemptions CSV" />
            <ExportButton onClick={exportAudits} label="Audit log CSV" />
            <ExportButton onClick={exportBackup} label="Full backup (JSON)" icon={FileJson} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Exports include every record on this phone. QR credentials are only in the JSON backup.
          </p>
        </div>

        <div className="mt-4 rounded-2xl border border-border/70 bg-card p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Restore</p>
          <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-xs font-medium">
            <Upload className="h-4 w-4 text-primary" />
            Choose a backup file
            <input type="file" accept=".json,application/json" onChange={pickBackup} className="hidden" />
          </label>

          {restorePreview ? (
            <div className="mt-3 rounded-xl border border-warning/30 bg-warning/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                <AlertTriangle className="h-3.5 w-3.5" /> Review before restoring
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {restorePreview.participants} participants, {restorePreview.redemptions} redemptions,{" "}
                {restorePreview.audits} audit events, {restorePreview.tokens} reserve passes.
                Existing newer records are kept; nothing is deleted.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={confirmRestore}
                  disabled={busy}
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60"
                >
                  Restore now
                </button>
                <button
                  onClick={() => {
                    setRestorePayload(null);
                    setRestorePreview(null);
                  }}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {message ? <p className="mt-2 text-xs text-muted-foreground">{message}</p> : null}
        </div>
      </div>
    </AppShell>
  );
}

function ExportButton({ onClick, label, icon: Icon = Download }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium"
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}