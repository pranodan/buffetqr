import { getSupabaseClient } from "@/api/supabaseClient";

const factorTypeFor = (method) => (method === "sms" ? "phone" : method);

export class MfaError extends Error {
  constructor(error) {
    super(error?.message || "Unable to verify your identity");
    this.name = "MfaError";
    this.status = error?.status;
    this.code = error?.code;
  }

  get mustSignInAgain() {
    return this.status === 401;
  }
}

function throwMfaError(error) {
  if (error) throw new MfaError(error);
}

export function mfaSession(challenge = {}) {
  const supabase = getSupabaseClient();
  const knownFactors = challenge.factors || null;
  const challenges = new Map();
  const pendingFactors = new Map();

  const listFactors = async () => {
    if (knownFactors) return knownFactors;
    const { data, error } = await supabase.auth.mfa.listFactors();
    throwMfaError(error);
    return [...data.totp, ...data.phone];
  };

  const findFactor = async (method, { pending = false } = {}) => {
    if (pending && pendingFactors.has(method)) return pendingFactors.get(method);
    const type = factorTypeFor(method);
    const factor = (await listFactors()).find(
      (item) => item.factor_type === type && (!pending || item.status !== "verified"),
    );
    if (!factor) throw new Error(`No ${method === "sms" ? "phone" : "authenticator"} factor is available.`);
    return factor;
  };

  const createChallenge = async (factor) => {
    const params = { factorId: factor.id };
    if (factor.factor_type === "phone") params.channel = "sms";
    const { data, error } = await supabase.auth.mfa.challenge(params);
    throwMfaError(error);
    challenges.set(factor.id, data.id);
    return data.id;
  };

  const verifyFactor = async (factor, code, { challengeId } = {}) => {
    const currentChallenge = challengeId || challenges.get(factor.id) || (await createChallenge(factor));
    const { data, error } = await supabase.auth.mfa.verify({
      factorId: factor.id,
      challengeId: currentChallenge,
      code,
    });
    throwMfaError(error);
    challenges.delete(factor.id);
    return { access_token: data.session?.access_token, session: data.session };
  };

  const enroll = async (method, phone) => {
    const params =
      method === "sms"
        ? { factorType: "phone", phone, friendlyName: "Buffet Access" }
        : { factorType: "totp", friendlyName: "Buffet Access", issuer: "Buffet Access" };
    const { data, error } = await supabase.auth.mfa.enroll(params);
    throwMfaError(error);
    const factor = { ...data, factor_type: factorTypeFor(method), status: "unverified" };
    pendingFactors.set(method, factor);
    if (method === "sms") await createChallenge(factor);

    return method === "sms"
      ? { phone: data.phone }
      : {
          qr_code: data.totp.qr_code,
          secret_formatted: data.totp.secret.match(/.{1,4}/g)?.join(" ") || data.totp.secret,
        };
  };

  return {
    verify: async (code, method) => verifyFactor(await findFactor(method), code),
    sendSignInCode: async () => createChallenge(await findFactor("sms")),
    setupAuthenticator: () => enroll("totp"),
    confirmAuthenticator: async (code) => {
      const factor = await findFactor("totp", { pending: true });
      return verifyFactor(factor, code);
    },
    sendPhoneCode: async (phone) => enroll("sms", phone),
    confirmPhone: async (code) => {
      const factor = await findFactor("sms", { pending: true });
      return verifyFactor(factor, code);
    },
    status: async () => {
      const factors = await listFactors();
      const verified = factors.filter((factor) => factor.status === "verified");
      const phone = verified.find((factor) => factor.factor_type === "phone")?.phone;
      return {
        methods: [...new Set(verified.map((factor) => (factor.factor_type === "phone" ? "sms" : "totp")))],
        phone_hint: phone ? `•••• ${phone.slice(-4)}` : "",
      };
    },
    sendProofCode: async () => createChallenge(await findFactor("sms")),
    removeMethod: async (method, code, proofMethod) => {
      const factor = await findFactor(proofMethod);
      await verifyFactor(factor, code);
      const target = await findFactor(method);
      const { error } = await supabase.auth.mfa.unenroll({ factorId: target.id });
      throwMfaError(error);
      return { success: true };
    },
    forgetDevices: async () => {
      throw new Error("Supabase Auth does not support clearing remembered devices.");
    },
  };
}

export async function signInWithProvider(provider, returnTo) {
  const providers = { google: "google", microsoft: "azure", facebook: "facebook", apple: "apple" };
  const supabaseProvider = providers[provider];
  if (!supabaseProvider) throw new Error(`The ${provider} sign-in provider is not configured.`);

  const redirectTo = new URL(returnTo || "/", window.location.origin).href;
  const { data, error } = await getSupabaseClient().auth.signInWithOAuth({
    provider: supabaseProvider,
    options: { redirectTo },
  });
  if (error) throw error;
  return data;
}

export function finishSignIn(_accessToken, returnTo) {
  window.location.assign(returnTo || "/");
}

export async function loadSignInOptions() {
  return {
    name: "Buffet Access",
    auth_config: {
      enable_username_password: true,
      enable_google_login: true,
      enable_microsoft_login: false,
      enable_facebook_login: false,
      enable_apple_login: false,
    },
  };
}
