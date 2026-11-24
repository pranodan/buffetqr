import { dbAll, dbGet, dbPut } from "@/lib/db";
import { secureToken } from "@/lib/tokens";
import { queue } from "@/lib/sync";
import { recordAudit } from "@/lib/audit";

export async function allTokens() {
  return dbAll("tokens");
}

export async function unusedTokens() {
  const list = await dbAll("tokens");
  return list.filter((t) => t.status === "UNUSED");
}

export async function generateReserveTokens(count, actor) {
  const batch = new Date().toISOString().slice(0, 10);
  const created = [];
  for (let i = 0; i < count; i++) {
    let token = secureToken();
    let guard = 0;
    while ((await dbGet("tokens", token)) && guard++ < 6) token = secureToken();
    const record = {
      token,
      status: "UNUSED",
      batch,
      assigned_participant_id: "",
      assigned_at: "",
      assigned_by: "",
      created_at: new Date().toISOString(),
      created_by: actor || "",
    };
    await dbPut("tokens", record);
    await queue("token", record);
    created.push(record);
  }
  await recordAudit({
    event_type: "RESERVE_TOKENS_GENERATED",
    actor,
    outcome: "SUCCESS",
    detail: `${count} tokens, batch ${batch}`,
  });
  return created;
}

export async function assignReserveToken(token, participantId, actor) {
  const record = await dbGet("tokens", token);
  if (!record) throw new Error("Reserve token not found");
  if (record.status !== "UNUSED") throw new Error("That reserve pass is already used");
  const next = {
    ...record,
    status: "ASSIGNED",
    assigned_participant_id: participantId,
    assigned_at: new Date().toISOString(),
    assigned_by: actor || "",
  };
  await dbPut("tokens", next);
  await queue("token", next, { sync: true });
  await recordAudit({
    event_type: "RESERVE_TOKEN_ASSIGNED",
    participant_id: participantId,
    actor,
    outcome: "SUCCESS",
    detail: token,
  });
  return next;
}

export async function revokeReserveToken(token, actor) {
  const record = await dbGet("tokens", token);
  if (!record) return;
  const next = { ...record, status: "REVOKED" };
  await dbPut("tokens", next);
  await queue("token", next);
  await recordAudit({
    event_type: "RESERVE_TOKEN_REVOKED",
    actor,
    outcome: "SUCCESS",
    detail: token,
  });
  return next;
}