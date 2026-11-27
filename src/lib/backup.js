import { dbAll, dbGet, dbPut, getMeta, setMeta } from "@/lib/db";
import { queue } from "@/lib/sync";

export async function buildBackup() {
  const [participants, redemptions, audits, tokens, conference] = await Promise.all([
    dbAll("participants"),
    dbAll("redemptions"),
    dbAll("audits"),
    dbAll("tokens"),
    getMeta("conference", null),
  ]);
  return {
    app: "buffet-access",
    version: 1,
    exported_at: new Date().toISOString(),
    counts: {
      participants: participants.length,
      redemptions: redemptions.length,
      audits: audits.length,
      tokens: tokens.length,
    },
    participants,
    redemptions,
    audits,
    tokens,
    conference,
  };
}

export function summariseBackup(payload) {
  return {
    exported_at: payload?.exported_at || null,
    participants: (payload?.participants || []).length,
    redemptions: (payload?.redemptions || []).length,
    audits: (payload?.audits || []).length,
    tokens: (payload?.tokens || []).length,
  };
}

/* Restores a backup by merging. Existing newer records win; nothing is deleted. */
export async function restoreBackup(payload) {
  let added = 0;
  let merged = 0;

  for (const p of payload.participants || []) {
    if (!p?.participant_id || !p?.qr_token) continue;
    const local = await dbGet("participants", p.participant_id);
    if (!local) {
      const restored = {
        ...p,
        dinner_eligible: p.dinner_eligible !== false,
        dinner_redeemed: !!p.dinner_redeemed,
        dinner_redeemed_at: p.dinner_redeemed_at || "",
        sync_state: "PENDING",
      };
      await dbPut("participants", restored);
      await queue("participant", restored);
      added++;
    } else if (new Date(p.last_modified || 0) > new Date(local.last_modified || 0)) {
      const next = {
        ...local,
        ...p,
        day1_redeemed: !!(local.day1_redeemed || p.day1_redeemed),
        day2_redeemed: !!(local.day2_redeemed || p.day2_redeemed),
        dinner_redeemed: !!(local.dinner_redeemed || p.dinner_redeemed),
        token_status: local.token_status === "REVOKED" ? "REVOKED" : p.token_status,
        sync_state: "PENDING",
      };
      await dbPut("participants", next);
      await queue("participant", next);
      merged++;
    }
  }

  for (const r of payload.redemptions || []) {
    if (!r?.dedupe_key) continue;
    const local = await dbGet("redemptions", r.dedupe_key);
    if (!local) {
      await dbPut("redemptions", { ...r, synced: false });
      await queue("redemption", r);
      added++;
    }
  }

  for (const a of payload.audits || []) {
    if (!a?.event_id) continue;
    const local = await dbGet("audits", a.event_id);
    if (!local) {
      await dbPut("audits", { ...a, synced: false });
      await queue("audit", a);
      added++;
    }
  }

  for (const t of payload.tokens || []) {
    if (!t?.token) continue;
    const local = await dbGet("tokens", t.token);
    if (!local) {
      await dbPut("tokens", t);
      await queue("token", t);
      added++;
    }
  }

  if (payload.conference) {
    const local = await getMeta("conference", null);
    if (!local) await setMeta("conference", payload.conference);
  }

  return { added, merged };
}