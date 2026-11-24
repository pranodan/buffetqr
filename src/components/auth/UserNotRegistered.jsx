import { UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import { AuthLayout } from "./AuthLayout";

// Signed in, but not assigned a staff role in this app.
export function UserNotRegistered() {
  const { logout } = useAuth();
  return (
    <AuthLayout icon={UserX} title="Access not granted" subtitle="Your account is not registered for this app.">
      <p className="mb-6 text-center text-sm text-foreground">Ask an administrator to add your email under Staff roles, then sign in again.</p>
      <Button variant="outline" className="h-12 w-full font-medium" onClick={logout}>
        Sign out
      </Button>
    </AuthLayout>
  );
}
