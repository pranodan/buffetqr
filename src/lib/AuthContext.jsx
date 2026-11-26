import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo } from "react";
import { dbGet, dbPut } from "@/lib/db";
import { currentUrl } from "@/lib/authReturnTo";
import { getSupabaseClient, isSupabaseConfigured } from "@/api/supabaseClient";

export const authQuery = queryOptions({
  queryKey: ["auth", "me"],
  queryFn: async () => {
    if (typeof window === "undefined") return { user: null, error: null };

    const supabase = getSupabaseClient();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const authUser = sessionData.session?.user;
    if (!authUser?.email) return { user: null, error: null };

    const email = authUser.email.toLowerCase();
    const { data: staff, error: staffError } = await supabase
      .from("staff")
      .select("email, display_name, role")
      .eq("email", email)
      .maybeSingle();

    let staffRecord = staff;
    if (staffError) {
      if (navigator.onLine) throw staffError;
      staffRecord = await dbGet("staff", email);
      if (!staffRecord) throw staffError;
    } else if (staffRecord) {
      await dbPut("staff", staffRecord);
    }

    if (!staffRecord) {
      return { user: null, error: { type: "user_not_registered", message: "Account is not enabled for this app" } };
    }

    return {
      user: {
        ...authUser,
        email,
        full_name: staffRecord.display_name || authUser.user_metadata?.full_name || email,
        role: staffRecord.role,
      },
      error: null,
    };
  },
  staleTime: 30_000,
  retry: false,
});

const AuthContext = createContext(null);

/**
 * Client-side session state. The server renders every page anonymously and the
 * query only runs in the browser after hydration, so the first client render
 * matches the server markup. Gate user-specific UI on `isLoadingAuth`.
 */
export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const { data, error, isPending } = useQuery(authQuery);

  useEffect(() => {
    if (!isSupabaseConfigured()) return undefined;
    const { data } = getSupabaseClient().auth.onAuthStateChange(() => {
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: authQuery.queryKey });
      }, 0);
    });
    const refreshStaffRole = () => {
      void queryClient.invalidateQueries({ queryKey: authQuery.queryKey });
    };
    window.addEventListener("buffetflow:staff-updated", refreshStaffRole);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("buffetflow:staff-updated", refreshStaffRole);
    };
  }, [queryClient]);

  const value = useMemo(
    () => ({
      user: data?.user ?? null,
      isAuthenticated: !!data?.user,
      isLoadingAuth: isPending,
      authError: data?.error ?? (error ? { type: "unknown", message: error.message ?? "Failed to load session" } : null),
      refresh: () => queryClient.fetchQuery({ ...authQuery, staleTime: 0 }),
      logout: async () => {
        const { error: signOutError } = await getSupabaseClient().auth.signOut();
        if (signOutError) throw signOutError;
        queryClient.setQueryData(authQuery.queryKey, { user: null, error: null });
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.getRegistration();
          registration?.active?.postMessage({ type: "PURGE_CACHED_PAGES" });
        }
        window.location.assign("/login");
      },
      navigateToLogin: () => {
        window.location.assign(`/login?returnTo=${encodeURIComponent(currentUrl())}`);
      },
    }),
    [data, error, isPending, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
