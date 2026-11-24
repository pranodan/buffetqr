import { ShieldAlert } from "lucide-react";
import { Link } from "@tanstack/react-router";

export default function NoAccess({ role }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-border/70 bg-card p-6 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-warning/10 text-warning">
        <ShieldAlert className="h-6 w-6" />
      </span>
      <h1 className="mt-4 font-heading text-lg font-semibold">Not available for your role</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        You are signed in as {role || "an operator"}. Ask the super admin if you need access to this
        module.
      </p>
      <Link
        to="/"
        className="mt-5 inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
      >
        Back to overview
      </Link>
    </div>
  );
}