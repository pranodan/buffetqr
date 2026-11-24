import { useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { MfaManage } from "@/components/auth/MfaManage";
import { MfaNotice, MfaScreen } from "@/components/auth/MfaParts";
import { UserNotRegistered } from "@/components/auth/UserNotRegistered";
import { useAuth } from "@/lib/AuthContext";
import { mfaSession } from "@/lib/authMfaFlow";

export function MfaPage() {
  const { user, isLoadingAuth, authError } = useAuth();
  const session = useMemo(() => (user ? mfaSession() : null), [user]);

  useEffect(() => {
    if (!isLoadingAuth && !user && !authError) {
      window.location.replace(`/login?returnTo=${encodeURIComponent("/mfa")}`);
    }
  }, [authError, isLoadingAuth, user]);

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (authError?.type === "user_not_registered") {
    return <UserNotRegistered />;
  }

  if (authError) {
    return <MfaScreen><MfaNotice error={new Error(authError.message)} /></MfaScreen>;
  }

  if (!user) return null;
  return <MfaScreen><MfaManage session={session} returnTo="/settings" /></MfaScreen>;
}
