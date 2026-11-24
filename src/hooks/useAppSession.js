import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { resolveRole } from "@/lib/roles";
import { setMeta } from "@/lib/db";
import { startAutoSync } from "@/lib/sync";

export function useAppSession() {
  const { user, isLoadingAuth } = useAuth();
  const [role, setRole] = useState(null);

  useEffect(() => {
    if (!user) {
      setRole(null);
      return;
    }
    let alive = true;
    resolveRole(user).then(async (resolved) => {
      if (!alive) return;
      setRole(resolved);
      await setMeta("device_role", resolved);
      await setMeta("operator", user.full_name || user.email || "");
      startAutoSync();
    });
    return () => {
      alive = false;
    };
  }, [user]);

  return { user, role, loading: isLoadingAuth || !role };
}