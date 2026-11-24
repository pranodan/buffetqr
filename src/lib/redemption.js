import { dbAll, dbGet, dbTransaction } from "@/lib/db";
import { getDeviceId } from "@/lib/device";
import { newTransactionId, isWellFormedToken } from "@/lib/tokens";
import { queue } from "@/lib/sync";
import { makeAuditEvent, recordAudit } from "@/lib/audit";

export const SESSIONS = ["day1", "day2"];

/* Commits a buffet entry for one participant and one session.
   The duplicate check and the write happen inside a single local transaction,
   so a successful entry is on disk before the operator sees the result. */
async function commitEntry({ participant, session, actor, type, reason }) {
  const timestamp = new Date().toISOString();
  const dedupeKey = `${participant.participant_id}::${session}`;
  const transactionId = newTransactionId();

  const outcome = await dbTransaction(["participants", "redemptions", "audits"], "readwrite", async (tx) => {
    const fresh = await tx.get("participants", participant.participant_id);
    if (!fresh) return { status: "INVALID" };
    if (fresh.token_status !== "ACTIVE") return { status: "REVOKED", participant: fresh };
    const eligible = session === "day2" ? fresh.day2_eligible : fresh.day1_eligible;
    if (!eligible) return { status: "NOT_ELIGIBLE", participant: fresh };
    const existing = await tx.get("redemptions", dedupeKey);
    if (existing) return { status: "DUPLICATE", participant: fresh, existing };

    const redemption = {
      dedupe_key: dedupeKey,
      transaction_id: transactionId,
      participant_id: fresh.participant_id,
      participant_name: fresh.full_name,
      qr_token: fresh.qr_token,
      session,
      device_id: getDeviceId(),
      operator: actor || "",
      timestamp,
      type,
      reason: reason || "",
      synced: false,
    };
    await tx.put("redemptions", redemption);

    const updated = {
      ...fresh,
      [`${session}_redeemed`]: true,
      [`${session}_redeemed_at`]: timestamp,
    };
    await tx.put("participants", updated);

    const audit = makeAuditEvent({
      event_type: type === "MANUAL_EXCEPTION" ? "MANUAL_EXCEPTION" : "REDEMPTION_GRANTED",
      participant_id: fresh.participant_id,
      actor,
      session,
      outcome: "GRANTED",
      reason: reason || "",
      detail: type === "MANUAL_EXCEPTION" ? "Manual entry authorised by administrator" : "QR scan",
      timestamp,
    });
    await tx.put("audits", audit);

    return { status: "GRANTED", participant: updated, redemption, audit };
  });

  if (outcome.status === "GRANTED") {
    await queue("redemption", outcome.redemption);
    await queue("audit", outcome.audit);
  } else if (outcome.status === "DUPLICATE") {
    await recordAudit({
      event_type: "SCAN_DUPLICATE",
      participant_id: participant.participant_id,
      actor,
      session,
      outcome: "REJECTED",
      reason: "Already redeemed in this session",
      detail: outcome.existing?.timestamp || "",
    });
  } else if (outcome.status === "NOT_ELIGIBLE") {
    await recordAudit({
      event_type: "SCAN_INELIGIBLE",
      participant_id: participant.participant_id,
      actor,
      session,
      outcome: "REJECTED",
      reason: `Not eligible for ${session}`,
    });
  }
  return outcome;
}

export async function resolveScan(rawToken, session, { actor } = {}) {
  const token = String(rawToken || "").trim().toLowerCase();

  if (!isWellFormedToken(token)) {
    await recordAudit({
      event_type: "SCAN_INVALID",
      actor,
      session,
      outcome: "REJECTED",
      reason: "Malformed QR payload",
      detail: token.slice(0, 48),
    });
    return { code: "INVALID", message: "This is not a buffet pass." };
  }

  const participants = await dbAll("participants");
  const participant = participants.find((p) => p.qr_token === token);

  if (!participant) {
    const reserve = await dbGet("tokens", token);
    if (reserve && reserve.status === "UNUSED") {
      await recordAudit({
        event_type: "SCAN_INVALID",
        actor,
        session,
        outcome: "REJECTED",
        reason: "Reserve token not assigned",
        detail: token,
      });
      return { code: "INVALID", message: "Reserve pass not assigned to anyone." };
    }
    await recordAudit({
      event_type: "SCAN_INVALID",
      actor,
      session,
      outcome: "REJECTED",
      reason: "Token not found on this device",
      detail: token,
    });
    return {
      code: "INVALID",
      message: "Pass not recognised here. It may not have reached this phone yet.",
    };
  }

  if (participant.token_status !== "ACTIVE") {
    await recordAudit({
      event_type: "SCAN_REVOKED",
      participant_id: participant.participant_id,
      actor,
      session,
      outcome: "REJECTED",
      reason: "Token revoked",
    });
    return { code: "REVOKED", participant, message: "This pass was revoked or replaced." };
  }

  const eligible = session === "day2" ? participant.day2_eligible : participant.day1_eligible;
  if (!eligible) {
    await recordAudit({
      event_type: "SCAN_INELIGIBLE",
      participant_id: participant.participant_id,
      actor,
      session,
      outcome: "REJECTED",
      reason: `Not eligible for ${session}`,
    });
    return {
      code: "NOT_ELIGIBLE",
      participant,
      message: `Not eligible for ${session === "day2" ? "Day 2" : "Day 1"}.`,
    };
  }

  try {
    const result = await commitEntry({ participant, session, actor, type: "SCAN", reason: "" });
    if (result.status === "GRANTED") {
      return { code: "GRANTED", participant: result.participant, redemption: result.redemption };
    }
    if (result.status === "DUPLICATE") {
      return {
        code: "DUPLICATE",
        participant: result.participant,
        existing: result.existing,
        message: "Already redeemed this session.",
      };
    }
    if (result.status === "NOT_ELIGIBLE") {
      return { code: "NOT_ELIGIBLE", participant: result.participant, message: "Not eligible for this session." };
    }
    if (result.status === "REVOKED") {
      return { code: "REVOKED", participant: result.participant, message: "This pass was revoked." };
    }
    return { code: "INVALID", message: "Participant record missing on this phone." };
  } catch (err) {
    return {
      code: "ERROR",
      message: "Could not save the entry on this phone. Do not admit.",
      detail: String(err?.message || err),
    };
  }
}

export async function commitManualException({ participant, session, reason, actor }) {
  if (!reason || !reason.trim()) throw new Error("A reason is required for a manual exception");
  const result = await commitEntry({
    participant,
    session,
    actor,
    type: "MANUAL_EXCEPTION",
    reason: reason.trim(),
  });
  return result;
}

export async function redemptionFor(participantId, session) {
  return dbGet("redemptions", `${participantId}::${session}`);
}

export async function allRedemptions() {
  return dbAll("redemptions");
}