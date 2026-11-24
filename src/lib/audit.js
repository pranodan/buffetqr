import { dbPut } from "@/lib/db";
import { getDeviceId } from "@/lib/device";
import { queue } from "@/lib/sync";
import { newEventId } from "@/lib/tokens";

export function makeAuditEvent({
  event_type,
  participant_id,
  actor,
  session,
  outcome,
  reason,
  detail,
  timestamp,
}) {
  return {
    event_id: newEventId(),
    event_type,
    participant_id: participant_id || "",
    device_id: getDeviceId(),
    actor: actor || "",
    timestamp: timestamp || new Date().toISOString(),
    session: session || "",
    outcome: outcome || "",
    reason: reason || "",
    detail: detail || "",
    synced: false,
  };
}

/* Audit events are append-only: the app never edits or removes them. */
export async function recordAudit(fields, { enqueue = true } = {}) {
  const event = makeAuditEvent(fields);
  await dbPut("audits", event);
  if (enqueue) await queue("audit", event);
  return event;
}