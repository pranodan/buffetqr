export default function PageLoading({ label = "Loading" }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-primary" />
      <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
    </div>
  );
}