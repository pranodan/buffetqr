import { dbPut } from "@/lib/db";
import { normalizeName } from "@/lib/participants";
import { secureToken } from "@/lib/tokens";
import { queue, refreshPending, runSync } from "@/lib/sync";
import { recordAudit } from "@/lib/audit";
import { parseBoolean } from "@/lib/csv";

export const REQUIRED_HEADERS = ["participant_id", "full_name", "category", "day1_eligible", "day2_eligible"];

const BOOLEAN_VALUES = ["1", "0", "true", "false", "yes", "no", "y", "n", ""];

export function validateImport(records, existingList) {
  const existingById = new Map(existingList.map((p) => [String(p.participant_id).toLowerCase(), p]));
  const seenIds = new Map();
  const seenNames = new Map();

  const rows = records.map((raw, index) => {
    const errors = [];
    const warnings = [];
    const id = String(raw.participant_id || "").trim();
    const name = String(raw.full_name || "").trim();

    if (!id) errors.push("Missing participant_id");
    if (!name) errors.push("Missing full_name");
    if (id && seenIds.has(id.toLowerCase())) {
      errors.push(`Duplicate participant_id (also on line ${seenIds.get(id.toLowerCase()) + 2})`);
    }
    if (id) seenIds.set(id.toLowerCase(), index);

    const d1 = String(raw.day1_eligible ?? "").trim().toLowerCase();
    const d2 = String(raw.day2_eligible ?? "").trim().toLowerCase();
    if (!BOOLEAN_VALUES.includes(d1)) warnings.push("day1_eligible not recognised, assumed eligible");
    if (!BOOLEAN_VALUES.includes(d2)) warnings.push("day2_eligible not recognised, assumed eligible");

    const normalized = normalizeName(name);
    if (normalized && seenNames.has(normalized) && seenNames.get(normalized) !== id) {
      warnings.push("Same name appears on another line");
    }
    if (normalized) seenNames.set(normalized, id);

    const existing = id ? existingById.get(id.toLowerCase()) : null;

    return {
      line: index + 2,
      participant_id: id,
      full_name: name,
      category: String(raw.category || "").trim(),
      institution: String(raw.institution || "").trim(),
      designation: String(raw.designation || "").trim(),
      email: String(raw.email || "").trim(),
      phone: String(raw.phone || "").trim(),
      day1_eligible: parseBoolean(raw.day1_eligible, true),
      day2_eligible: parseBoolean(raw.day2_eligible, true),
      existing,
      errors,
      warnings,
      action: errors.length ? "error" : existing ? "update" : "create",
    };
  });

  const summary = {
    total: rows.length,
    create: rows.filter((r) => r.action === "create").length,
    update: rows.filter((r) => r.action === "update").length,
    errors: rows.filter((r) => r.action === "error").length,
    warnings: rows.filter((r) => r.warnings.length).length,
  };
  return { rows, summary };
}

export async function applyImport(rows, actor) {
  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    if (row.errors.length) continue;
    if (row.existing) {
      const next = {
        ...row.existing,
        full_name: row.full_name,
        category: row.category || row.existing.category,
        institution: row.institution || row.existing.institution,
        designation: row.designation || row.existing.designation,
        email: row.email || row.existing.email,
        phone: row.phone || row.existing.phone,
        day1_eligible: row.day1_eligible,
        day2_eligible: row.day2_eligible,
        last_modified: now,
        sync_state: "PENDING",
      };
      await dbPut("participants", next);
      await queue("participant", next);
      updated++;
    } else {
      const record = {
        participant_id: row.participant_id,
        full_name: row.full_name,
        category: row.category || "Participant",
        institution: row.institution,
        designation: row.designation,
        email: row.email,
        phone: row.phone,
        qr_token: secureToken(),
        day1_eligible: row.day1_eligible,
        day2_eligible: row.day2_eligible,
        day1_redeemed: false,
        day2_redeemed: false,
        day1_redeemed_at: "",
        day2_redeemed_at: "",
        registration_source: "PRE_REGISTERED",
        registration_timestamp: now,
        registered_by: actor || "",
        token_status: "ACTIVE",
        last_modified: now,
        sync_state: "PENDING",
        cloud_id: null,
      };
      await dbPut("participants", record);
      await queue("participant", record);
      created++;
    }
  }

  await refreshPending();
  await recordAudit({
    event_type: "PARTICIPANT_IMPORT",
    actor,
    outcome: "SUCCESS",
    detail: `${created} created, ${updated} updated`,
  });
  runSync("after-import");
  return { created, updated };
}

export function importTemplate() {
  return [
    "participant_id,full_name,category,institution,day1_eligible,day2_eligible,designation,email,phone",
    "NMC-001,Dr. Aashish Shrestha,Delegate,Teaching Hospital,true,true,Consultant,aashish@example.com,9800000001",
    "NMC-002,Dr. Bina Karki,Speaker,Patan Academy,true,false,Professor,bina@example.com,9800000002",
  ].join("\r\n");
}