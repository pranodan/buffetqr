import { Check, X, AlertTriangle, Ban, Clock } from "lucide-react";
import { timeNPT } from "@/lib/format";

const THEMES = {
  GRANTED: {
    bg: "bg-success",
    icon: Check,
    title: "Access granted",
    tone: "text-success-foreground",
  },
  DUPLICATE: {
    bg: "bg-destructive",
    icon: X,
    title: "Already redeemed",
    tone: "text-destructive-foreground",
  },
  NOT_ELIGIBLE: {
    bg: "bg-warning",
    icon: Ban,
    title: "Not eligible",
    tone: "text-warning-foreground",
  },
  INVALID: {
    bg: "bg-destructive",
    icon: AlertTriangle,
    title: "Invalid pass",
    tone: "text-destructive-foreground",
  },
  REVOKED: {
    bg: "bg-destructive",
    icon: Ban,
    title: "Pass revoked",
    tone: "text-destructive-foreground",
  },
  ERROR: {
    bg: "bg-warning",
    icon: AlertTriangle,
    title: "Could not save entry",
    tone: "text-warning-foreground",
  },
};

export default function ScanResult({ result, sessionName, onDismiss, actionLabel = "Tap to scan again" }) {
  if (!result) return null;
  const theme = THEMES[result.code] || THEMES.ERROR;
  const Icon = theme.icon;
  const participant = result.participant;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={theme.title}
      className={`fixed inset-0 z-50 flex w-full flex-col items-center justify-center px-6 text-center ${theme.bg} ${theme.tone}`}
    >
      <span className="grid h-20 w-20 place-items-center rounded-full bg-white/20">
        <Icon className="h-11 w-11" strokeWidth={2.6} />
      </span>
      <p className="mt-5 text-[13px] font-medium uppercase tracking-[0.2em] opacity-80">{theme.title}</p>
      {participant ? (
        <>
          <h2 className="mt-2 font-heading text-[30px] font-semibold leading-tight">{participant.full_name}</h2>
          <p className="mono mt-1 text-sm opacity-85">{participant.participant_id}</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
            <span className="rounded-full bg-white/20 px-3 py-1">{sessionName}</span>
            <span className="rounded-full bg-white/20 px-3 py-1">{participant.category || "Participant"}</span>
          </div>
          {result.code === "DUPLICATE" && result.existing && (
            <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs">
              <Clock className="h-3.5 w-3.5" /> Redeemed at {timeNPT(result.existing.timestamp)}
            </p>
          )}
        </>
      ) : (
        <h2 className="mt-2 max-w-xs font-heading text-2xl font-semibold leading-snug">
          {result.message || "Pass not recognised"}
        </h2>
      )}
      {result.message && participant && (
        <p className="mt-4 max-w-xs text-sm opacity-90">{result.message}</p>
      )}
      {result.code === "GRANTED" && (
        <p className="mt-6 text-xs uppercase tracking-[0.2em] opacity-70">Saved on this phone</p>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="absolute bottom-8 rounded-full bg-white/20 px-5 py-3 text-[11px] font-medium uppercase tracking-[0.2em]"
      >
        {actionLabel}
      </button>
    </div>
  );
}