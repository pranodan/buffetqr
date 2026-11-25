import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Save, Loader2, Trash2, LogOut, Volume2, Smartphone, ShieldCheck } from "lucide-react";
import AppShell from "@/components/AppShell";
import NoAccess from "@/components/NoAccess";
import PageLoading from "@/components/PageLoading";
import PageHeader from "@/components/PageHeader";
import { useAppSession } from "@/hooks/useAppSession";
import { useConference } from "@/hooks/useConference";
import { useAuth } from "@/lib/AuthContext";
import { DEFAULT_CONFERENCE, getConference, saveConference, savePrefs } from "@/lib/settings";
import { dbAll, dbClearAll, dbPut } from "@/lib/db";
import { queue, resetOperationalData, runSync } from "@/lib/sync";
import { getSupabaseClient } from "@/api/supabaseClient";
import { getDeviceId, getDeviceName, setDeviceName } from "@/lib/device";
import { recordAudit } from "@/lib/audit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/settings")({
  head: () => ({ meta: [{ title: "Settings · Buffet Access" }] }),
  component: SettingsPage,
});

const STAFF_ROLES = [
  { id: "admin", label: "Super admin" },
  { id: "registration", label: "Registration desk" },
  { id: "buffet", label: "Buffet operator" },
];

function SettingsPage() {
  const { user, role, loading } = useAppSession();
  const { conference, prefs, ready, updatePrefs, reload } = useConference();
  const { logout } = useAuth();

  const [form, setForm] = useState(null);
  const [staff, setStaff] = useState([]);
  const [newStaff, setNewStaff] = useState({ email: "", display_name: "", role: "registration" });
  const [deviceName, setDeviceNameState] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetMfa, setResetMfa] = useState(null);
  const [resetMfaCode, setResetMfaCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    runSync("settings-load")
      .then(async () => {
        const [config, rows] = await Promise.all([getConference(), dbAll("staff")]);
        if (!active) return;
        setForm(config);
        setStaff(rows.sort((a, b) => a.email.localeCompare(b.email)));
      })
      .catch((err) => setError(String(err?.message || err)));
    setDeviceNameState(getDeviceName());
    return () => {
      active = false;
    };
  }, []);

  const saveConfig = async () => {
    setBusy(true);
    setError("");
    try {
      await saveConference(form);
      await reload();
      setMessage("Conference settings saved and queued for the other phones.");
      runSync("settings");
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  const addStaff = async (e) => {
    e.preventDefault();
    setError("");
    if (!newStaff.email.trim()) return;
    const record = {
      email: newStaff.email.trim().toLowerCase(),
      display_name: newStaff.display_name.trim(),
      role: newStaff.role,
    };
    await dbPut("staff", record);
    await queue("staff", record, { sync: true });
    await recordAudit({
      event_type: "STAFF_ROLE_ASSIGNED",
      actor: user?.email || "admin",
      outcome: "SUCCESS",
      detail: `${record.email} as ${record.role}`,
    });
    setStaff((prev) => [...prev.filter((s) => s.email !== record.email), record]);
    setNewStaff({ email: "", display_name: "", role: "registration" });
    setMessage(`${record.email} will act as ${record.role} after syncing.`);
  };

  const resetLocal = async () => {
    if (!window.confirm("Erase all data stored on this phone? Unsynced changes will be lost.")) return;
    await dbClearAll();
    window.location.reload();
  };

  const finishOperationalReset = async () => {
    const result = await resetOperationalData();
    setResetMfa(null);
    setResetMfaCode("");
    setResetPassword("");
    setResetConfirmation("");
    setMessage(
      `Deleted ${result.participants} participants, ${result.redemptions} redemptions, and ${result.reserve_tokens} reserve passes.`
    );
  };

  const confirmOperationalReset = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    if (resetConfirmation !== "RESET") {
      setError('Type "RESET" to confirm this action.');
      return;
    }
    if (!user?.email || !resetPassword) {
      setError("Enter your current account password.");
      return;
    }
    setResetBusy(true);
    try {
      const supabase = getSupabaseClient();
      const { error: passwordError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: resetPassword,
      });
      if (passwordError) throw passwordError;
      setResetPassword("");

      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (assurance.currentLevel !== "aal2" && assurance.nextLevel === "aal2") {
        const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
        if (factorsError) throw factorsError;
        const factor = [...factors.totp, ...factors.phone].find((item) => item.status === "verified");
        if (!factor) throw new Error("A second authentication factor is required but none is available.");
        const params = { factorId: factor.id };
        if (factor.factor_type === "phone") params.channel = "sms";
        const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge(params);
        if (challengeError) throw challengeError;
        setResetMfa({
          factorId: factor.id,
          challengeId: challenge.id,
          factorType: factor.factor_type,
          phone: factor.phone,
        });
        return;
      }
      await finishOperationalReset();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setResetBusy(false);
    }
  };

  const verifyResetMfa = async (e) => {
    e.preventDefault();
    if (!resetMfa || resetMfaCode.length !== 6) return;
    setError("");
    setResetBusy(true);
    try {
      const supabase = getSupabaseClient();
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: resetMfa.factorId,
        challengeId: resetMfa.challengeId,
        code: resetMfaCode,
      });
      if (verifyError) throw verifyError;
      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (assurance.currentLevel !== "aal2") throw new Error("Multi-factor verification did not complete.");
      setResetMfa(null);
      await finishOperationalReset();
    } catch (err) {
      setError(String(err?.message || err));
      setResetMfaCode("");
    } finally {
      setResetBusy(false);
    }
  };

  if (loading || !ready || !form) {
    return (
      <AppShell role={role || "admin"}>
        <PageLoading label="Loading settings" />
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
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <PageHeader
          eyebrow={conference.name}
          title="Settings"
          description="Conference details, staff roles and device behaviour."
        />

        {message ? <p className="rounded-xl bg-success/8 px-3 py-2 text-xs text-success">{message}</p> : null}
        {error ? <p className="rounded-xl bg-destructive/8 px-3 py-2 text-xs text-destructive">{error}</p> : null}

        <section className="rounded-2xl border border-border/70 bg-card p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Conference and sessions
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Labeled label="Conference name">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
            </Labeled>
            <Labeled label="Active buffet session">
              <select
                value={form.active_session || "day1"}
                onChange={(e) => setForm({ ...form, active_session: e.target.value })}
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
              >
                <option value="day1">{form.day1_name || "Day 1"}</option>
                <option value="day2">{form.day2_name || "Day 2"}</option>
              </select>
            </Labeled>
            <Labeled label="Day 1 name">
              <input
                value={form.day1_name}
                onChange={(e) => setForm({ ...form, day1_name: e.target.value })}
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
            </Labeled>
            <Labeled label="Day 1 date">
              <input
                type="date"
                value={form.day1_date || ""}
                onChange={(e) => setForm({ ...form, day1_date: e.target.value })}
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
            </Labeled>
            <Labeled label="Day 2 name">
              <input
                value={form.day2_name}
                onChange={(e) => setForm({ ...form, day2_name: e.target.value })}
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
            </Labeled>
            <Labeled label="Day 2 date">
              <input
                type="date"
                value={form.day2_date || ""}
                onChange={(e) => setForm({ ...form, day2_date: e.target.value })}
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
            </Labeled>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <Toggle
              label="Day 1 buffet enabled"
              checked={form.day1_enabled !== false}
              onChange={(v) => setForm({ ...form, day1_enabled: v })}
            />
            <Toggle
              label="Day 2 buffet enabled"
              checked={form.day2_enabled !== false}
              onChange={(v) => setForm({ ...form, day2_enabled: v })}
            />
          </div>
          <div className="mt-3 rounded-xl border border-border/60 px-3 py-2.5">
            <Toggle
              label="Automatically scan the next pass"
              checked={form.auto_scan !== false}
              onChange={(v) => setForm({ ...form, auto_scan: v })}
            />
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              When off, the scanner waits for the operator to press Scan next after each result. This setting syncs
              to the other phones.
            </p>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={saveConfig}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
            </button>
            <button
              onClick={() => setForm({ ...DEFAULT_CONFERENCE })}
              className="rounded-xl border border-border px-3.5 py-2.5 text-xs font-medium"
            >
              Reset form
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Changing the active session never resets redemption records.
          </p>
        </section>

        <section className="rounded-2xl border border-border/70 bg-card p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">This device</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Labeled label="Device name">
              <input
                value={deviceName}
                onChange={(e) => setDeviceNameState(e.target.value)}
                onBlur={() => setDeviceName(deviceName)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
            </Labeled>
            <Labeled label="Device ID">
              <p className="mono rounded-xl bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">{getDeviceId()}</p>
            </Labeled>
          </div>
          <div className="mt-3">
            <Toggle
              label="Sound on scan result"
              checked={prefs.audio_enabled !== false}
              onChange={async (v) => updatePrefs({ audio_enabled: v })}
              icon={Volume2}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-border/70 bg-card p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> Staff roles
          </p>
          <div className="mt-3 divide-y divide-border/60">
            {staff.map((s) => (
              <div key={s.email} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{s.display_name || s.email}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{s.email}</p>
                </div>
                <select
                  value={s.role}
                  disabled={s.email === (user?.email || "").trim().toLowerCase() && s.role === "admin"}
                  onChange={async (e) => {
                    const next = { ...s, role: e.target.value };
                    await dbPut("staff", next);
                    await queue("staff", next, { sync: true });
                    setStaff((prev) => prev.map((row) => (row.email === s.email ? next : row)));
                  }}
                  className="shrink-0 rounded-lg border border-input bg-background px-2 py-1.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {STAFF_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {!staff.length ? (
              <p className="py-3 text-xs text-muted-foreground">
                No operator roles yet. App admins always have full access.
              </p>
            ) : null}
          </div>

          <form onSubmit={addStaff} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              value={newStaff.email}
              onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
              placeholder="operator@email.com"
              inputMode="email"
              className="rounded-xl border border-input bg-background px-3 py-2.5 text-xs outline-none focus:border-primary"
            />
            <input
              value={newStaff.display_name}
              onChange={(e) => setNewStaff({ ...newStaff, display_name: e.target.value })}
              placeholder="Name"
              className="rounded-xl border border-input bg-background px-3 py-2.5 text-xs outline-none focus:border-primary"
            />
            <div className="flex gap-2">
              <select
                value={newStaff.role}
                onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })}
                className="rounded-xl border border-input bg-background px-2 py-2.5 text-xs"
              >
                {STAFF_ROLES.filter((r) => r.id !== "admin").map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-xl bg-primary px-3 py-2.5 text-xs font-medium text-primary-foreground"
              >
                Add
              </button>
            </div>
          </form>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Add the email and role before the person registers. They can sign up with that email and confirm it;
            Supabase row-level security enforces their access.
          </p>
        </section>

        <section className="rounded-2xl border border-border/70 bg-card p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-destructive">
            <Trash2 className="h-3.5 w-3.5" /> Reset conference records
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Permanently deletes all participants, buffet redemptions, and reserve passes from the shared database
            and this phone. Staff, conference settings, devices, and audit history are retained. Other phones clear
            these records when they next sync.
          </p>
          {resetMfa ? (
            <form onSubmit={verifyResetMfa} className="mt-3 space-y-2">
              <p className="text-xs">
                {resetMfa.factorType === "phone"
                  ? `Enter the verification code sent to ${resetMfa.phone || "your phone"}.`
                  : "Enter the code from your authenticator app."}
              </p>
              <Labeled label="6-digit verification code">
                <input
                  value={resetMfaCode}
                  onChange={(e) => setResetMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                />
              </Labeled>
              <button
                type="submit"
                disabled={resetBusy || resetMfaCode.length !== 6}
                className="inline-flex items-center gap-2 rounded-xl bg-destructive px-3.5 py-2.5 text-xs font-medium text-destructive-foreground disabled:opacity-60"
              >
                {resetBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Verify and delete records
              </button>
            </form>
          ) : (
            <form onSubmit={confirmOperationalReset} className="mt-3 grid gap-3 sm:grid-cols-2">
              <Labeled label='Type "RESET" to confirm'>
                <input
                  value={resetConfirmation}
                  onChange={(e) => setResetConfirmation(e.target.value)}
                  autoComplete="off"
                  className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                />
              </Labeled>
              <Labeled label="Current super admin password">
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                />
              </Labeled>
              <button
                type="submit"
                disabled={resetBusy || resetConfirmation !== "RESET" || !resetPassword}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-destructive px-3.5 py-2.5 text-xs font-medium text-destructive-foreground disabled:opacity-60 sm:col-span-2 sm:justify-self-start"
              >
                {resetBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {resetBusy ? "Confirming…" : "Verify password and delete records"}
              </button>
            </form>
          )}
        </section>

        <section className="rounded-2xl border border-border/70 bg-card p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Device data</p>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Local data can be lost if browser storage is cleared or the phone is reset. Keep the JSON backup
            from Reports, and sync regularly.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={resetLocal}
              className="inline-flex items-center gap-2 rounded-xl border border-destructive/30 px-3.5 py-2.5 text-xs font-medium text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear data on this phone
            </button>
            <button
              onClick={() => logout()}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2.5 text-xs font-medium"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Smartphone className="h-3.5 w-3.5" /> Install this app to the home screen for offline use.
          </p>
        </section>
      </div>
    </AppShell>
  );
}

function Labeled({ label, children }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function Toggle({ label, checked, onChange, icon: Icon }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-xs"
    >
      <span
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted-foreground/30"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
            checked ? "left-[18px]" : "left-0.5"
          )}
        />
      </span>
      {Icon ? <Icon className="h-3.5 w-3.5 text-muted-foreground" /> : null}
      {label}
    </button>
  );
}