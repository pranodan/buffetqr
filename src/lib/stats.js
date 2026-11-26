import { dbAll, getMeta, setMeta } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { queue } from "@/lib/sync";

export async function computeStats() {
  const [participants, redemptions, tokens, audits, duplicateAttemptsResetAt] = await Promise.all([
    dbAll("participants"),
    dbAll("redemptions"),
    dbAll("tokens"),
    dbAll("audits"),
    getMeta("duplicateAttemptsResetAt", ""),
  ]);
  const resetTime = Date.parse(duplicateAttemptsResetAt || "");

  const counts = {
    total: participants.length,
    pre: 0,
    spot: 0,
    manual: 0,
    active: 0,
    revoked: 0,
    reserveUnused: 0,
    reserveAssigned: 0,
  };

  participants.forEach((p) => {
    if (p.registration_source === "PRE_REGISTERED") counts.pre++;
    else if (p.registration_source === "SPOT_REGISTERED") counts.spot++;
    else counts.manual++;
    if (p.token_status === "ACTIVE") counts.active++;
    else counts.revoked++;
  });

  tokens.forEach((t) => {
    if (t.status === "UNUSED") counts.reserveUnused++;
    if (t.status === "ASSIGNED") counts.reserveAssigned++;
  });

  const sessions = {
    day1: { eligible: 0, redeemed: 0, manual: 0, duplicates: 0, invalid: 0, ineligible: 0 },
    day2: { eligible: 0, redeemed: 0, manual: 0, duplicates: 0, invalid: 0, ineligible: 0 },
  };

  participants.forEach((p) => {
    if (p.day1_eligible) sessions.day1.eligible++;
    if (p.day2_eligible) sessions.day2.eligible++;
  });

  redemptions.forEach((r) => {
    const bucket = sessions[r.session];
    if (!bucket) return;
    bucket.redeemed++;
    if (r.type === "MANUAL_EXCEPTION") bucket.manual++;
  });

  audits.forEach((a) => {
    const bucket = sessions[a.session];
    if (!bucket) return;
    if (a.event_type === "SCAN_DUPLICATE" && (!Number.isFinite(resetTime) || Date.parse(a.timestamp || "") > resetTime)) bucket.duplicates++;
    if (a.event_type === "SCAN_INVALID" || a.event_type === "SCAN_REVOKED") bucket.invalid++;
    if (a.event_type === "SCAN_INELIGIBLE") bucket.ineligible++;
  });

  return { counts, sessions, participants, redemptions, tokens, audits, duplicateAttemptsResetAt };
}

export async function resetDuplicateAttempts(actor = "") {
  const resetAt = new Date().toISOString();
  await setMeta("duplicateAttemptsResetAt", resetAt);
  await queue("setting", {
    key: "duplicate_attempts_reset_at",
    value: resetAt,
    updated_by: actor,
  });
  await recordAudit({
    event_type: "DUPLICATE_ATTEMPTS_RESET",
    actor,
    outcome: "SUCCESS",
    timestamp: resetAt,
    detail: "Global duplicate scan counters reset. Historical audit events retained.",
  });
  return resetAt;
}