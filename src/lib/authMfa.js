import { getSupabaseClient } from "@/api/supabaseClient";
import { signInWithProvider } from "@/lib/authMfaFlow";

export async function loginWithMfa(email, password) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;

  const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) throw assuranceError;
  if (assurance.currentLevel === "aal1" && assurance.nextLevel === "aal2") {
    const { data: factorData, error: factorError } = await supabase.auth.mfa.listFactors();
    if (factorError) throw factorError;
    const factors = [...factorData.totp, ...factorData.phone];
    if (factors.length) {
      return {
        mfa_required: true,
        next_step: "verify",
        mfa_methods: [
          ...(factorData.totp.length ? ["totp"] : []),
          ...(factorData.phone.length ? ["sms"] : []),
        ],
        phone_hint: factorData.phone[0]?.phone
          ? `•••• ${factorData.phone[0].phone.slice(-4)}`
          : "your phone",
        factors,
      };
    }
  }

  return data;
}

export function loginWithSocial(provider, returnTo) {
  return signInWithProvider(provider, returnTo);
}

export function loginWithGoogle(returnTo) {
  return loginWithSocial("google", returnTo);
}
