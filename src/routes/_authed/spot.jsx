import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { UserPlus, CheckCircle2, AlertTriangle, Loader2, ArrowRight, Camera, Keyboard, Ticket } from "lucide-react";
import AppShell from "@/components/AppShell";
import NoAccess from "@/components/NoAccess";
import PageLoading from "@/components/PageLoading";
import PageHeader from "@/components/PageHeader";
import SyncBadge from "@/components/SyncBadge";
import ScanCamera from "@/components/scanner/ScanCamera";
import { useAppSession } from "@/hooks/useAppSession";
import { useConference } from "@/hooks/useConference";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { createParticipant, getParticipant, similarParticipants } from "@/lib/participants";
import { dbGet } from "@/lib/db";
import { availabilityFor, refreshPending } from "@/lib/sync";
import { qrDataUrl } from "@/lib/qr";
import { getDeviceId } from "@/lib/device";
import { isWellFormedToken } from "@/lib/tokens";

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
    day1_eligible: true,
    day2_eligible: true,
    dinner_eligible: true,
  });
  const [matches, setMatches] = useState([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const [qr, setQr] = useState(null);
  const [scannedToken, setScannedToken] = useState(null);
  const [manualToken, setManualToken] = useState("");

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
    setScannedToken(null);
    setManualToken("");
    setForm({ full_name: "", category: "Participant", institution: "", designation: "", email: "", phone: "", day1_eligible: true, day2_eligible: true, dinner_eligible: true });
    setMatches([]);
    setConfirmed(false);
    setError("");
  };

  const handlePassCode = async (raw) => {
    setError("");
    const token = String(raw || "").trim().toLowerCase();
    if (!isWellFormedToken(token)) {
      setError("That is not a valid reserve-pass QR code.");
      return;
    }
    try {
      const reserve = await dbGet("tokens", token);
      if (!reserve) throw new Error("Reserve pass not found on this phone. Sync the reserve-pass list and try again.");
      if (reserve.status !== "UNUSED") throw new Error("That reserve pass has already been assigned or revoked.");
      setScannedToken(reserve);
      setManualToken("");
    } catch (err) {
      setError(String(err?.message || err));
    }
  };

  const submit = async (e) => {
    e?.preventDefault();
    setError("");
    if (!scannedToken) {
      setError("Scan an unused printed reserve pass first.");
      return;
    }
    if (!form.full_name.trim()) {
      setError("Enter the participant's full name.");
      return;
    }
    setBusy(true);
    try {
      const record = await createParticipant(
        { ...form, qr_token: scannedToken.token },
        { actor, source: "SPOT_REGISTERED" }
      );
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
          description="Scan a printed reserve pass, then register the walk-in using their name."
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
                  <p className="font-heading text-lg font-semibold leading-tight uppercase">{created.full_name}</p>
                  <p className="mono mt-1 text-xs text-muted-foreground">{created.participant_id}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {created.category}
                    {created.institution ? ` · ${created.institution}` : ""}
                  </p>
                  <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-success">
                    <Ticket className="h-3.5 w-3.5" /> Printed reserve pass assigned
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
                  onClick={reset}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
                >
                  <UserPlus className="h-4 w-4" /> Next person
                </button>
              </div>
            </div>
          </div>
        ) : !scannedToken ? (
          <div className="space-y-3">
            <div className="rounded-3xl border border-border/70 bg-card p-4">
              <p className="mb-3 inline-flex items-center gap-2 text-sm font-medium">
                <Camera className="h-4 w-4 text-primary" /> Scan an unused printed reserve pass
              </p>
              <ScanCamera enabled={!busy} onDecoded={handlePassCode} onError={() => setError("Camera unavailable. Enter the printed pass code below.")} />
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handlePassCode(manualToken);
                }}
                className="mt-3 flex gap-2"
              >
                <label className="sr-only" htmlFor="reserve-pass-code">Reserve pass code</label>
                <input
                  id="reserve-pass-code"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder="Or enter the 32-character pass code"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="mono min-w-0 flex-1 rounded-xl border border-input bg-background px-3 py-2.5 text-xs outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-xs font-medium text-primary-foreground"
                >
                  <Keyboard className="h-3.5 w-3.5" /> Use pass
                </button>
              </form>
              {error ? <p role="alert" className="mt-3 rounded-xl bg-destructive/8 px-3 py-2 text-xs text-destructive">{error}</p> : null}
            </div>
            <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
              The pass is checked against the synced reserve list. Already assigned or revoked passes cannot be used.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="rounded-3xl border border-border/70 bg-card p-4">
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Scanned pass</p>
                  <p className="mono truncate text-xs">{scannedToken.token}</p>
                </div>
                <button type="button" onClick={reset} className="shrink-0 text-[11px] font-medium text-primary">
                  Scan another
                </button>
              </div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Full name
              </label>
              <input
                value={form.full_name}
                onChange={set("full_name")}
                autoFocus
                placeholder="e.g. Dr. Sita Sharma"
                className="mt-1.5 w-full rounded-xl border border-input bg-background px-3.5 py-3 font-heading text-lg uppercase outline-none focus:border-primary"
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
                          {m.full_name.toUpperCase()} <span className="mono text-muted-foreground">{m.participant_id}</span>
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

              <div className="mt-4 rounded-xl border border-border/70 p-3">
                <p className="mb-3 text-xs font-semibold">Entry eligibility</p>
                <div className="space-y-3">
                  {[
                    ["day1_eligible", "Day 1 buffet"],
                    ["day2_eligible", "Day 2 buffet"],
                    ["dinner_eligible", "Dinner"],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between text-xs">
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={form[key]}
                        onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.checked }))}
                        className="h-4 w-4 accent-primary"
                      />
                    </label>
                  ))}
                </div>
              </div>

              {error ? (
                <p role="alert" className="mt-3 rounded-xl bg-destructive/8 px-3 py-2 text-xs text-destructive">{error}</p>
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
              Eligibility defaults to all three sessions. For dinner-only guests, uncheck Day 1 and Day 2. This screen assigns the scanned preprinted reserve QR; it does not generate a new QR.
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