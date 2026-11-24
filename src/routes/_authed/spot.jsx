import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { UserPlus, Printer, Download, CheckCircle2, AlertTriangle, Loader2, ArrowRight } from "lucide-react";
import AppShell from "@/components/AppShell";
import NoAccess from "@/components/NoAccess";
import PageLoading from "@/components/PageLoading";
import PageHeader from "@/components/PageHeader";
import SyncBadge from "@/components/SyncBadge";
import { useAppSession } from "@/hooks/useAppSession";
import { useConference } from "@/hooks/useConference";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { createParticipant, getParticipant, similarParticipants } from "@/lib/participants";
import { assignReserveToken, unusedTokens } from "@/lib/reserve";
import { availabilityFor } from "@/lib/sync";
import { qrDataUrl } from "@/lib/qr";
import { printSingleSlip } from "@/lib/slipPrint";
import { downloadSlipPdf } from "@/lib/pdf";
import { refreshPending } from "@/lib/sync";
import { getDeviceId } from "@/lib/device";

export const Route = createFileRoute("/_authed/spot")({
  head: () => ({ meta: [{ title: "Spot registration · Buffet Access" }] }),
  component: RegisterPage,
});

const CATEGORIES = [
  "Participant",
  "Delegate",
  "Speaker",
  "Faculty",
  "Organiser",
  "Volunteer",
  "Student",
  "Guest",
  "Media",
  "Accompanying person",
];

function RegisterPage() {
  const { user, role, loading } = useAppSession();
  const { conference, ready } = useConference();
  const sync = useSyncStatus();
  const actor = user?.full_name || user?.email || "Registration desk";

  const [form, setForm] = useState({
    full_name: "",
    category: "Participant",
    institution: "",
    designation: "",
    email: "",
    phone: "",
  });
  const [matches, setMatches] = useState([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const [qr, setQr] = useState(null);
  const [reserveTokens, setReserveTokens] = useState([]);
  const [useReserve, setUseReserve] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const slipRef = useRef(null);

  useEffect(() => {
    unusedTokens().then(setReserveTokens);
  }, []);

  useEffect(() => {
    const name = form.full_name.trim();
    if (name.length < 3) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(async () => {
      setMatches(await similarParticipants(name));
    }, 250);
    return () => clearTimeout(timer);
  }, [form.full_name]);

  const availability = useMemo(() => {
    if (!created) return null;
    return availabilityFor(created, sync.devices, getDeviceId());
  }, [created, sync.devices, sync.lastSync]);

  // Re-read the stored record after each sync so the badge reflects the upload.
  useEffect(() => {
    if (!created) return;
    getParticipant(created.participant_id).then((fresh) => {
      if (fresh) setCreated(fresh);
    });
  }, [sync.lastSync, sync.running]);

  const set = (key) => (e) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    setConfirmed(false);
    setError("");
  };

  const reset = () => {
    setCreated(null);
    setQr(null);
    setForm({ full_name: "", category: "Participant", institution: "", designation: "", email: "", phone: "" });
    setMatches([]);
    setConfirmed(false);
    setError("");
    unusedTokens().then(setReserveTokens);
  };

  const submit = async (e) => {
    e?.preventDefault();
    setError("");
    if (!form.full_name.trim()) {
      setError("Enter the participant's full name.");
      return;
    }
    setBusy(true);
    try {
      let token = null;
      if (useReserve) {
        const available = await unusedTokens();
        if (!available.length) throw new Error("No unused reserve passes left. Register without one.");
        token = available[0].token;
      }
      const record = await createParticipant(
        { ...form, qr_token: token || undefined },
        { actor, source: "SPOT_REGISTERED" }
      );
      if (token) await assignReserveToken(token, record.participant_id, actor);
      const image = await qrDataUrl(record.qr_token, 480);
      setQr(image);
      setCreated(record);
      setMatches([]);
      await refreshPending();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async () => {
    if (!slipRef.current) return;
    setPdfBusy(true);
    try {
      await downloadSlipPdf(slipRef.current, `${created?.participant_id || "slip"}.pdf`);
    } finally {
      setPdfBusy(false);
    }
  };

  if (loading || !ready) {
    return (
      <AppShell role={role || "registration"}>
        <PageLoading label="Opening registration" />
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
      <div className="mx-auto w-full max-w-xl">
        <PageHeader
          eyebrow={conference.name}
          title="Spot registration"
          description="Name alone is enough. A unique ID and pass are created automatically."
          actions={<SyncBadge state={availability || "PENDING"} />}
        />

        {created ? (
          <div className="space-y-3">
            <div className="rounded-3xl border border-success/25 bg-success/5 p-5">
              <div className="flex items-center gap-2 text-success">
                <CheckCircle2 className="h-5 w-5" />
                <p className="font-heading text-sm font-semibold">Registered</p>
              </div>
              <div className="mt-4 flex items-start gap-4">
                {qr ? (
                  <img
                    src={qr}
                    alt="Participant QR code"
                    className="h-32 w-32 shrink-0 rounded-xl border border-black/10 bg-white p-1.5"
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="font-heading text-lg font-semibold leading-tight">{created.full_name}</p>
                  <p className="mono mt-1 text-xs text-muted-foreground">{created.participant_id}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {created.category}
                    {created.institution ? ` · ${created.institution}` : ""}
                  </p>
                  <div className="mt-3">
                    <SyncBadge state={availability} />
                  </div>
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                {availability === "AVAILABLE"
                  ? "The buffet scanner has this pass and can admit the participant now."
                  : availability === "FAILED"
                    ? "Upload failed. Tap Sync now, or use a manual exception at the buffet."
                    : "Saved on this phone. The buffet scanner will accept it once this record reaches it."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    printSingleSlip({
                      name: created.full_name,
                      id: created.participant_id,
                      category: created.category,
                      institution: created.institution,
                      qr,
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
                >
                  <Printer className="h-4 w-4" /> Print slip
                </button>
                <button
                  onClick={downloadPdf}
                  disabled={pdfBusy}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium disabled:opacity-60"
                >
                  {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF
                </button>
                <button
                  onClick={reset}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium"
                >
                  <UserPlus className="h-4 w-4" /> Next person
                </button>
              </div>
            </div>

            {/* Hidden sheet used for the PDF export */}
            <div className="pointer-events-none fixed -left-[2000px] top-0" aria-hidden="true">
              <div ref={slipRef}>
                <div className="slip-page">
                  <div className="slip">
                    <div className="slip-qr">{qr ? <img src={qr} alt="" /> : null}</div>
                    <div className="min-w-0 flex-1">
                      <div className="slip-name">{created.full_name}</div>
                      <div className="slip-id">{created.participant_id}</div>
                      <div className="slip-meta">{created.category}</div>
                      {created.institution ? <div className="slip-meta">{created.institution}</div> : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="rounded-3xl border border-border/70 bg-card p-4">
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Full name
              </label>
              <input
                value={form.full_name}
                onChange={set("full_name")}
                autoFocus
                placeholder="e.g. Dr. Sita Sharma"
                className="mt-1.5 w-full rounded-xl border border-input bg-background px-3.5 py-3 font-heading text-lg outline-none focus:border-primary"
              />

              {matches.length ? (
                <div className="mt-3 rounded-xl border border-warning/30 bg-warning/5 p-3">
                  <p className="flex items-center gap-1.5 text-[12px] font-medium text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" /> Similar name already registered
                  </p>
                  <ul className="mt-2 space-y-1">
                    {matches.map((m) => (
                      <li key={m.participant_id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate">
                          {m.full_name} <span className="mono text-muted-foreground">{m.participant_id}</span>
                        </span>
                        <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                          {m.registration_source === "SPOT_REGISTERED" ? "spot" : "pre-registered"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    If this is the same person, no new pass is needed. Otherwise continue below.
                  </p>
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Category">
                  <select
                    value={form.category}
                    onChange={set("category")}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Institution (optional)">
                  <input
                    value={form.institution}
                    onChange={set("institution")}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                  />
                </Field>
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  More details (optional)
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Designation">
                    <input
                      value={form.designation}
                      onChange={set("designation")}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                    />
                  </Field>
                  <Field label="Phone">
                    <input
                      value={form.phone}
                      onChange={set("phone")}
                      inputMode="tel"
                      className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                    />
                  </Field>
                  <Field label="Email">
                    <input
                      value={form.email}
                      onChange={set("email")}
                      inputMode="email"
                      className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                    />
                  </Field>
                </div>
              </details>

              {reserveTokens.length ? (
                <label className="mt-4 flex items-start gap-2.5 rounded-xl bg-muted/60 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={useReserve}
                    onChange={(e) => setUseReserve(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                  />
                  <span className="text-[12px] leading-relaxed text-muted-foreground">
                    Use a pre-printed reserve pass ({reserveTokens.length} unused). It becomes linked to this
                    person permanently.
                  </span>
                </label>
              ) : null}

              {error ? (
                <p className="mt-3 rounded-xl bg-destructive/8 px-3 py-2 text-xs text-destructive">{error}</p>
              ) : null}

              <button
                type="submit"
                disabled={busy}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 font-heading text-[15px] font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                {matches.length && !confirmed ? "Register anyway" : "Register participant"}
              </button>
              {matches.length && !confirmed ? (
                <button
                  type="button"
                  onClick={() => setConfirmed(true)}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 text-[11px] text-muted-foreground"
                >
                  I checked the list, this is a new person <ArrowRight className="h-3 w-3" />
                </button>
              ) : null}
            </div>

            <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
              Day 1 and Day 2 eligibility default to yes. The super admin can change eligibility for anyone.
            </p>
          </form>
        )}
      </div>
    </AppShell>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}