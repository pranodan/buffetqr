const STYLES = {
  AVAILABLE: { label: "Synced · available at buffet", className: "bg-success/10 text-success" },
  PENDING: { label: "Pending sync · not at buffet yet", className: "bg-warning/10 text-warning" },
  FAILED: { label: "Sync failed · retry required", className: "bg-destructive/10 text-destructive" },
  ACTIVE: { label: "Active", className: "bg-success/10 text-success" },
  REVOKED: { label: "Revoked", className: "bg-destructive/10 text-destructive" },
  UNUSED: { label: "Unused", className: "bg-warning/10 text-warning" },
  ASSIGNED: { label: "Assigned", className: "bg-success/10 text-success" },
};

export default function SyncBadge({ state }) {
  const style = STYLES[state] || STYLES.PENDING;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${style.className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {style.label}
    </span>
  );
}