import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Lock, RefreshCw, Camera, Keyboard, Loader2, CloudOff } from "lucide-react";
import AppShell from "@/components/AppShell";
import NoAccess from "@/components/NoAccess";
import PageLoading from "@/components/PageLoading";
import ScanCamera from "@/components/scanner/ScanCamera";
import ScanResult from "@/components/scanner/ScanResult";
import { useAppSession } from "@/hooks/useAppSession";
import { useConference } from "@/hooks/useConference";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { allParticipants } from "@/lib/participants";
import { allRedemptions, resolveScan } from "@/lib/redemption";
import { recordAudit } from "@/lib/audit";
import { beep } from "@/lib/feedback";
import { runSync } from "@/lib/sync";
import { saveConference, sessionLabel } from "@/lib/settings";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/scanner")({
  head: () => ({ meta: [{ title: "Buffet scanner · Buffet Access" }] }),
  component: ScannerPage,
});

function ScannerPage() {
  const { user, role, loading } = useAppSession();
  const { conference, prefs, ready, setConference } = useConference();
  const sync = useSyncStatus();

  const [now, setNow] = useState(() => new Date());
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [manual, setManual] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [counts, setCounts] = useState({ eligible: 0, redeemed: 0 });
  const [checking, setChecking] = useState(false);
  const busyRef = useRef(false);

  const session = conference.active_session || "day1";
  const autoScan = conference.auto_scan !== false;
  const actor = user?.full_name || user?.email || "Buffet operator";

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const refreshCounts = async () => {
    const [participants, redemptions] = await Promise.all([allParticipants(), allRedemptions()]);
    const eligible = participants.filter((p) => (session === "day2" ? p.day2_eligible : p.day1_eligible)).length;
    const redeemed = redemptions.filter((r) => r.session === session).length;
    setCounts({ eligible, redeemed });
  };

  useEffect(() => {
    refreshCounts();
    const timer = setInterval(refreshCounts, 15000);
    return () => clearInterval(timer);
  }, [session, sync.lastSync]);

  const handleCode = async (raw) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setChecking(true);
    const res = await resolveScan(raw, session, { actor });
    setChecking(false);
    setResult(res);
    if (prefs.audio_enabled !== false) {
      beep(res.code === "GRANTED" ? "success" : res.code === "NOT_ELIGIBLE" || res.code === "ERROR" ? "warn" : "error");
    }
    refreshCounts();
    if (autoScan) {
      const delay = res.code === "GRANTED" ? 1700 : 3200;
      window.setTimeout(() => {
        setResult(null);
        busyRef.current = false;
        setBusy(false);
      }, delay);
    }
  };

  const dismiss = () => {
    setResult(null);
    busyRef.current = false;
    setBusy(false);
  };

  const changeSession = async (next) => {
    if (role !== "admin" || next === session) return;
    const config = { ...conference, active_session: next };
    setConference(config);
    await saveConference(config);
    await recordAudit({ event_type: "SESSION_CHANGED", actor, session: next, outcome: "SUCCESS", detail: `Active session set to ${next}` });
    runSync("session-change");
  };

  if (loading || !ready) {
    return (
      <AppShell role={role || "buffet"}>
        <PageLoading label="Preparing scanner" />
      </AppShell>
    );
  }
  if (!["admin", "buffet"].includes(role)) {
    return (
      <AppShell role={role} conferenceName={conference.name}>
        <NoAccess role={role} />
      </AppShell>
    );
  }

  const remaining = Math.max(counts.eligible - counts.redeemed, 0);
  const clock = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Kathmandu", hour12: false });

  return (
    <AppShell role={role} conferenceName={conference.name}>
      <div className="mx-auto w-full max-w-md space-y-3">
        <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-card px-3.5 py-2.5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Session</p>
            <p className="font-heading text-[15px] font-semibold leading-tight">{sessionLabel(conference, session)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Nepal time</p>
            <p className="num font-heading text-[15px] font-semibold leading-tight">{clock}</p>
          </div>
        </div>

        {role === "admin" ? (
          <div className="grid grid-cols-2 gap-2">
            {["day1", "day2"].map((s) => (
              <button
                key={s}
                onClick={() => changeSession(s)}
                className={cn(
                  "rounded-xl border px-3 py-2 text-[12px] font-medium transition-colors",
                  session === s
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/70 bg-card text-muted-foreground"
                )}
              >
                {sessionLabel(conference, s)}
              </button>
            ))}
          </div>
        ) : (
          <p className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3" /> Session is set by the super admin.
          </p>
        )}

        {cameraError ? (
          <div className="rounded-2xl border border-warning/30 bg-warning/5 p-5 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-warning/15 text-warning">
              <Camera className="h-5 w-5" />
            </span>
            <p className="mt-3 font-heading text-sm font-semibold">Camera not available</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Allow camera access in the browser, or type the pass code below.
            </p>
            <button
              onClick={() => {
                setCameraError(null);
                setShowManual(true);
              }}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
            >
              <RefreshCw className="h-4 w-4" /> Retry camera
            </button>
          </div>
        ) : (
          <ScanCamera enabled={!busy} onDecoded={handleCode} onError={() => setCameraError(true)} />
        )}

        <div className="grid grid-cols-3 gap-2">
          <Stat label="Redeemed" value={counts.redeemed} />
          <Stat label="Remaining" value={remaining} />
          <Stat label="Eligible" value={counts.eligible} />
        </div>

        <div className="rounded-2xl border border-border/70 bg-card px-3.5 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Sync</p>
              <p className="truncate text-xs">
                {sync.online ? (sync.running ? "Syncing…" : `Last sync ${relativeTime(sync.lastSync)}`) : "Offline · working locally"}
                {sync.pending ? ` · ${sync.pending} pending` : ""}
              </p>
            </div>
            <button
              onClick={() => runSync("manual")}
              disabled={sync.running}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-50"
            >
              {sync.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Sync now
            </button>
          </div>
          {!sync.online && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-warning">
              <CloudOff className="h-3.5 w-3.5" /> Scans are saved on this phone and upload automatically.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-border/70 bg-card px-3.5 py-3">
          <button
            onClick={() => setShowManual((v) => !v)}
            className="flex w-full items-center justify-between text-left text-xs font-medium text-muted-foreground"
          >
            <span className="inline-flex items-center gap-1.5">
              <Keyboard className="h-3.5 w-3.5" /> Enter pass code manually
            </span>
            <span>{showManual ? "Hide" : "Open"}</span>
          </button>
          {showManual && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!manual.trim()) return;
                handleCode(manual.trim());
                setManual("");
              }}
              className="mt-3 flex gap-2"
            >
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="32-character code"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="mono min-w-0 flex-1 rounded-xl border border-input bg-background px-3 py-2 text-xs outline-none focus:border-primary"
              />
              <button
                type="submit"
                disabled={checking}
                className="rounded-xl bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60"
              >
                Check
              </button>
            </form>
          )}
        </div>
      </div>

      <ScanResult
        result={result}
        sessionName={sessionLabel(conference, session)}
        onDismiss={dismiss}
        actionLabel={autoScan ? "Tap to scan again" : "Scan next"}
      />
    </AppShell>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-2 py-2 text-center">
      <p className="num font-heading text-xl font-semibold leading-none">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}