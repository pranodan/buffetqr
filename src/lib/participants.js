import { dbAll, dbDelete, dbGet, dbPut, dbTransaction } from "@/lib/db";
import { getDeviceId } from "@/lib/device";
import { newParticipantId, secureToken } from "@/lib/tokens";
import { queue } from "@/lib/sync";
import { recordAudit } from "@/lib/audit";

export function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\p{Script=Devanagari} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function allParticipants() {
  return dbAll("participants");
}

export async function getParticipant(id) {
  return dbGet("participants", id);
}

export async function findByToken(token) {
  const list = await dbAll("participants");
  return list.find((p) => p.qr_token === token) || null;
}

export async function similarParticipants(name) {
  const q = normalizeName(name);
  if (!q) return [];
  const list = await dbAll("participants");
  return list
    .filter((p) => {
      const n = normalizeName(p.full_name);
      if (!n) return false;
      return n === q || n.includes(q) || (q.includes(n) && n.length > 3);
    })
    .slice(0, 5);
}

async function uniqueParticipantId(prefix) {
  for (let i = 0; i < 8; i++) {
    const id = newParticipantId(prefix);
    if (!(await dbGet("participants", id))) return id;
  }
  throw new Error("Could not allocate a participant ID");
}

export async function createParticipant(input, { actor, source = "SPOT_REGISTERED" } = {}) {
    if (!String(input.full_name || "").trim()) {
    throw new Error("Participant name is required.");
  }
  const now = new Date().toISOString();
  const participantId = input.participant_id || (await uniqueParticipantId(source === "MANUALLY_ADDED" ? "MN" : "SP"));
  const reserveToken = input.qr_token ? await dbGet("tokens", String(input.qr_token).trim().toLowerCase()) : null;
  if (input.qr_token && reserveToken?.status !== "UNUSED") {
    throw new Error("That reserve pass is no longer available. Scan an unused pass and try again.");
  }
  const record = {
    participant_id: participantId,
    full_name: String(input.full_name || "").trim(),
    category: input.category || "Participant",
    institution: input.institution || "",
    designation: input.designation || "",
    email: input.email || "",
    phone: input.phone || "",
    qr_token: reserveToken?.token || secureToken(),
    day1_eligible: input.day1_eligible !== false,
    day2_eligible: input.day2_eligible !== false,
    dinner_eligible: input.dinner_eligible !== false,
    day1_redeemed: false,
    day2_redeemed: false,
    dinner_redeemed: false,
    day1_redeemed_at: "",
    day2_redeemed_at: "",
    dinner_redeemed_at: "",
    registration_source: source,
    registration_timestamp: now,
    registered_by: actor || "",
    token_status: "ACTIVE",
    last_modified: now,
    device_id: getDeviceId(),
    sync_state: "PENDING",
    cloud_id: null,
  };
  let assignedToken = null;
  if (reserveToken) {
    assignedToken = {
      ...reserveToken,
      status: "ASSIGNED",
      assigned_participant_id: participantId,
      assigned_at: now,
      assigned_by: actor || "",
    };
    await dbTransaction(["participants", "tokens"], "readwrite", async (tx) => {
      const currentToken = await tx.get("tokens", reserveToken.token);
      if (!currentToken || currentToken.status !== "UNUSED") {
        throw new Error("That reserve pass was just assigned elsewhere. Scan an unused pass and try again.");
      }
      await tx.put("participants", record);
      await tx.put("tokens", assignedToken);
    });
  } else {
    await dbPut("participants", record);
  }
  await queue("participant", record, { sync: true });
  if (assignedToken) await queue("token", assignedToken, { sync: true });
  await recordAudit({
    event_type: source === "MANUALLY_ADDED" ? "PARTICIPANT_ADDED" : "SPOT_REGISTRATION",
    participant_id: record.participant_id,
    actor,
    outcome: "SUCCESS",
    detail: record.full_name,
  });
  if (assignedToken) {
    await recordAudit({
      event_type: "RESERVE_TOKEN_ASSIGNED",
      participant_id: participantId,
      actor,
      outcome: "SUCCESS",
      detail: assignedToken.token,
    });
  }
  return record;
}

export async function updateParticipant(id, patch, actor) {
  const existing = await dbGet("participants", id);
  if (!existing) throw new Error("Participant not found");
  const next = { ...existing, ...patch, last_modified: new Date().toISOString(), sync_state: "PENDING" };
  await dbPut("participants", next);
  await queue("participant", next, { sync: true });
  await recordAudit({
    event_type: "PARTICIPANT_UPDATED",
    participant_id: id,
    actor,
    outcome: "SUCCESS",
    detail: Object.keys(patch).join(", "),
  });
  return next;
}

/* Replaces the QR credential. The old token is revoked permanently and is never reused. */
export async function replaceToken(id, actor) {
  const existing = await dbGet("participants", id);
  if (!existing) throw new Error("Participant not found");
  const oldToken = existing.qr_token;
  const next = {
    ...existing,
    qr_token: secureToken(),
    token_status: "ACTIVE",
    last_modified: new Date().toISOString(),
    sync_state: "PENDING",
  };
  await dbPut("participants", next);
  await queue("participant", next, { sync: true });
  await recordAudit({
    event_type: "TOKEN_REPLACED",
    participant_id: id,
    actor,
    outcome: "SUCCESS",
    reason: "QR slip reissued",
    detail: `old=${oldToken} new=${next.qr_token}`,
  });
  return next;
}

export async function revokeToken(id, actor, reason) {
  const existing = await dbGet("participants", id);
  if (!existing) throw new Error("Participant not found");
  const next = {
    ...existing,
    token_status: "REVOKED",
    last_modified: new Date().toISOString(),
    sync_state: "PENDING",
  };
  await dbPut("participants", next);
  await queue("participant", next, { sync: true });
  await recordAudit({
    event_type: "TOKEN_REVOKED",
    participant_id: id,
    actor,
    outcome: "SUCCESS",
    reason: reason || "Revoked by administrator",
    detail: existing.qr_token,
  });
  return next;
}

export async function resetParticipantScan(id, session, actor) {
  if (!["day1", "day2", "dinner"].includes(session)) throw new Error("Invalid buffet session");
  const timestamp = new Date().toISOString();
  const generation = crypto.randomUUID();
  const dedupeKey = `${id}::${session}`;
  let updated;

  await dbTransaction(["participants", "redemptions"], "readwrite", async (tx) => {
    const existing = await tx.get("participants", id);
    if (!existing) throw new Error("Participant not found");
    updated = {
      ...existing,
      [`${session}_redeemed`]: false,
      [`${session}_redeemed_at`]: "",
      [`${session}_scan_reset_at`]: timestamp,
      [`${session}_scan_generation`]: generation,
      last_modified: timestamp,
      sync_state: "PENDING",
    };
    await tx.put("participants", updated);
    await tx.delete("redemptions", dedupeKey);
  });

  await queue("redemption_reset", {
    participant_id: id,
    session,
    scan_generation: generation,
    actor: actor || "",
    timestamp,
  }, { sync: true });
  await recordAudit({
    event_type: "SCAN_RESET",
    participant_id: id,
    actor,
    session,
    outcome: "SUCCESS",
    reason: "Scanned state reset by super admin",
    detail: "Participant marked not scanned",
    timestamp,
  });
  return updated;
}

export async function deleteParticipant(id, actor) {
  const existing = await dbGet("participants", id);
  if (!existing) return;
  await dbDelete("participants", id);
  await recordAudit({
    event_type: "PARTICIPANT_DELETED",
    participant_id: id,
    actor,
    outcome: "SUCCESS",
    detail: existing.full_name,
  });
}

export function participantStatusLabel(participant, session) {
  if (!participant) return "Unknown";
  if (participant.token_status === "REVOKED") return "Pass revoked";
  if (participant[`${session}_redeemed`]) return "Already redeemed";
  const eligible = participant[`${session}_eligible`];
  return eligible ? "Eligible" : "Not eligible";
}
