import { getSupabaseClient } from "@/api/supabaseClient";
import { dbAll, dbClear, dbDelete, dbGet, dbPut, getMeta, setMeta } from "@/lib/db";
import { getDeviceId, getDeviceName } from "@/lib/device";

/* Two-way sync between this device's IndexedDB and the shared conference database.
   Everything is idempotent: a retried upload never duplicates a record. */

let state = {
  running: false,
  phase: "",
  lastSync: null,
  online: true,
  pending: 0,
  failed: 0,
  error: null,
  devices: [],
};

const ORDER_COLUMNS = {
  participants: "participant_id",
  redemptions: "transaction_id",
  reserve_tokens: "token",
  app_settings: "key",
  staff: "email",
  devices: "device_id",
};

const listeners = new Set();

export function syncState() {
  return state;
}

export function subscribeSync(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

export async function refreshPending() {
  const items = await dbAll("outbox");
  setState({
    pending: items.length,
    failed: items.filter((i) => (i.attempts || 0) > 0 && i.last_error).length,
  });
}

export async function queue(kind, payload, { sync = false } = {}) {
  await dbPut("outbox", {
    kind,
    payload,
    created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
  });
  await refreshPending();
  if (sync && typeof navigator !== "undefined" && navigator.onLine) {
    runSync("after-write").catch(() => {});
  }
}

async function listAll(table) {
  const orderColumn = ORDER_COLUMNS[table];
  if (!orderColumn) throw new Error(`Unsupported sync table: ${table}`);
  const supabase = getSupabaseClient();
  const out = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(orderColumn, { ascending: true })
      .range(offset, offset + 199);
    if (error) throw error;
    out.push(...data);
    if (data.length < 200) break;
  }
  return out;
}

async function upsert(table, record, onConflict) {
  const { error } = await getSupabaseClient().from(table).upsert(record, { onConflict });
  if (error) throw error;
}

async function insertIfNew(table, record) {
  const { error } = await getSupabaseClient().from(table).insert(record);
  if (error && error.code !== "23505") throw error;
}

async function pushOne(item) {
  const p = item.payload || {};
  switch (item.kind) {
    case "participant": {
      const data = {
        participant_id: p.participant_id,
        full_name: p.full_name,
        category: p.category || "",
        institution: p.institution || "",
        designation: p.designation || "",
        email: p.email || "",
        phone: p.phone || "",
        qr_token: p.qr_token,
        day1_eligible: !!p.day1_eligible,
        day2_eligible: !!p.day2_eligible,
        dinner_eligible: p.dinner_eligible !== false,
        registration_source: p.registration_source || "PRE_REGISTERED",
        registration_timestamp: p.registration_timestamp || new Date().toISOString(),
        registered_by: p.registered_by || "",
        token_status: p.token_status || "ACTIVE",
        last_modified: p.last_modified || new Date().toISOString(),
        device_id: p.device_id || getDeviceId(),
      };
      await upsert("participants", data, "participant_id");
      const local = await dbGet("participants", p.participant_id);
      if (local) {
        await dbPut("participants", {
          ...local,
          cloud_id: p.participant_id,
          sync_state: "SYNCED",
          synced_at: new Date().toISOString(),
        });
      }
      return;
    }
    case "redemption": {
      await insertIfNew("redemptions", {
        transaction_id: p.transaction_id,
        participant_id: p.participant_id,
        participant_name: p.participant_name || "",
        qr_token: p.qr_token || "",
        scan_generation: p.scan_generation || null,
        session: p.session,
        device_id: p.device_id || getDeviceId(),
        operator: p.operator || "",
        timestamp: p.timestamp || new Date().toISOString(),
        type: p.type || "SCAN",
        reason: p.reason || "",
      });
      const local = await dbGet("redemptions", p.dedupe_key);
      if (local) await dbPut("redemptions", { ...local, synced: true });
      return;
    }
    case "redemption_reset": {
      const { error } = await getSupabaseClient().rpc("reset_participant_scan", {
        p_participant_id: p.participant_id,
        p_session: p.session,
        p_generation: p.scan_generation,
      });
      if (error) throw error;
      return;
    }
    case "audit": {
      await insertIfNew("audit_logs", {
        event_id: p.event_id,
        event_type: p.event_type,
        participant_id: p.participant_id || "",
        device_id: p.device_id || getDeviceId(),
        actor: p.actor || "",
        timestamp: p.timestamp || new Date().toISOString(),
        session: p.session || "",
        outcome: p.outcome || "",
        reason: p.reason || "",
        detail: p.detail || "",
      });
      const local = await dbGet("audits", p.event_id);
      if (local) await dbPut("audits", { ...local, synced: true });
      return;
    }
    case "token": {
      if (p.status === "ASSIGNED") {
        const { error } = await getSupabaseClient().rpc("assign_reserve_token", {
          p_token: p.token,
          p_participant_id: p.assigned_participant_id,
        });
        if (error) throw error;
        return;
      }
      const data = {
        token: p.token,
        status: p.status,
        batch: p.batch || "",
        assigned_participant_id: p.assigned_participant_id || "",
        assigned_at: p.assigned_at || null,
        assigned_by: p.assigned_by || "",
        created_at: p.created_at || new Date().toISOString(),
        created_by: p.created_by || "",
      };
      await upsert("reserve_tokens", data, "token");
      return;
    }
    case "setting": {
      const data = { key: p.key, value: p.value, updated_by: p.updated_by || "" };
      await upsert("app_settings", data, "key");
      return;
    }
    case "staff": {
      const data = { email: p.email, display_name: p.display_name || "", role: p.role };
      await upsert("staff", data, "email");
      return;
    }
    default:
      return;
  }
}

async function pushOutbox() {
  const items = (await dbAll("outbox")).sort((a, b) => (a.id || 0) - (b.id || 0));
  for (const item of items) {
    try {
      await pushOne(item);
      await dbDelete("outbox", item.id);
    } catch (err) {
      const message = String(err?.message || err);
      await dbPut("outbox", { ...item, attempts: (item.attempts || 0) + 1, last_error: message });
      if (item.kind === "participant") {
        const local = await dbGet("participants", item.payload.participant_id);
        if (local) await dbPut("participants", { ...local, sync_state: "FAILED" });
      }
    }
  }
  await refreshPending();
}

function mapCloudParticipant(c) {
  return {
    participant_id: c.participant_id,
    full_name: c.full_name,
    category: c.category || "",
    institution: c.institution || "",
    designation: c.designation || "",
    email: c.email || "",
    phone: c.phone || "",
    qr_token: c.qr_token,
    day1_eligible: !!c.day1_eligible,
    day2_eligible: !!c.day2_eligible,
    dinner_eligible: c.dinner_eligible !== false,
    day1_redeemed: !!c.day1_redeemed,
    day2_redeemed: !!c.day2_redeemed,
    dinner_redeemed: !!c.dinner_redeemed,
    day1_redeemed_at: c.day1_redeemed_at || "",
    day2_redeemed_at: c.day2_redeemed_at || "",
    dinner_redeemed_at: c.dinner_redeemed_at || "",
    day1_scan_reset_at: c.day1_scan_reset_at || "",
    day2_scan_reset_at: c.day2_scan_reset_at || "",
    dinner_scan_reset_at: c.dinner_scan_reset_at || "",
    day1_scan_generation: c.day1_scan_generation || "",
    day2_scan_generation: c.day2_scan_generation || "",
    dinner_scan_generation: c.dinner_scan_generation || "",
    registration_source: c.registration_source || "PRE_REGISTERED",
    registration_timestamp: c.registration_timestamp || c.created_at || "",
    registered_by: c.registered_by || "",
    token_status: c.token_status || "ACTIVE",
    last_modified: c.last_modified || c.updated_at || c.created_at || "",
    device_id: c.device_id || "",
    cloud_id: c.participant_id,
  };
}

async function pullAll() {
  const [cloudParticipants, cloudRedemptions, cloudTokens, cloudSettings, cloudStaff, cloudDevices] = await Promise.all([
    listAll("participants"),
    listAll("redemptions"),
    listAll("reserve_tokens"),
    listAll("app_settings"),
    listAll("staff"),
    listAll("devices"),
  ]);

  const cloudParticipantsById = new Map(cloudParticipants.map((participant) => [participant.participant_id, participant]));
  const initialOutbox = await dbAll("outbox");
  const pendingResetKeys = new Set(
    initialOutbox
      .filter((item) => item.kind === "redemption_reset")
      .map((item) => `${item.payload?.participant_id}::${item.payload?.session}`)
  );
  for (const item of initialOutbox) {
    if (item.kind !== "redemption") continue;
    const key = `${item.payload?.participant_id}::${item.payload?.session}`;
    if (pendingResetKeys.has(key)) continue;
    const remoteParticipant = cloudParticipantsById.get(item.payload?.participant_id);
    const generation = remoteParticipant?.[`${item.payload?.session}_scan_generation`] || null;
    if (remoteParticipant && generation !== (item.payload?.scan_generation || null)) {
      await dbDelete("outbox", item.id);
      if (item.payload?.dedupe_key) await dbDelete("redemptions", item.payload.dedupe_key);
    }
  }
  const outbox = await dbAll("outbox");
  const pendingParticipants = new Set(
    outbox.filter((i) => i.kind === "participant").map((i) => i.payload?.participant_id)
  );
  const pendingRedemptions = new Set(
    outbox.filter((i) => i.kind === "redemption").map((i) => i.payload?.dedupe_key)
  );
  const pendingRedemptionResets = new Set(
    outbox
      .filter((i) => i.kind === "redemption_reset")
      .map((i) => `${i.payload?.participant_id}::${i.payload?.session}`)
  );
  const pendingSettings = new Set(outbox.filter((i) => i.kind === "setting").map((i) => i.payload?.key));
  const cloudRedemptionKeys = new Set(cloudRedemptions.map((r) => `${r.participant_id}::${r.session}`));

  for (const c of cloudParticipants) {
    if (!c.participant_id || !c.qr_token) continue;
    const remote = mapCloudParticipant(c);
    const local = await dbGet("participants", c.participant_id);
    if (!local) {
      await dbPut("participants", { ...remote, sync_state: "SYNCED", synced_at: new Date().toISOString() });
      continue;
    }
    const keepLocal = pendingParticipants.has(c.participant_id);
    const remoteNewer = new Date(remote.last_modified || 0) > new Date(local.last_modified || 0);
    const merged = !keepLocal && remoteNewer ? { ...local, ...remote } : { ...remote, ...local };
    merged.cloud_id = c.participant_id;
    const day1Key = `${c.participant_id}::day1`;
    const day2Key = `${c.participant_id}::day2`;
    const dinnerKey = `${c.participant_id}::dinner`;
    merged.day1_redeemed = pendingRedemptionResets.has(day1Key)
      ? false
      : pendingRedemptions.has(day1Key)
        ? !!local.day1_redeemed
        : !!remote.day1_redeemed;
    merged.day2_redeemed = pendingRedemptionResets.has(day2Key)
      ? false
      : pendingRedemptions.has(day2Key)
        ? !!local.day2_redeemed
        : !!remote.day2_redeemed;
    merged.dinner_redeemed = pendingRedemptionResets.has(dinnerKey)
      ? false
      : pendingRedemptions.has(dinnerKey)
        ? !!local.dinner_redeemed
        : !!remote.dinner_redeemed;
    merged.day1_redeemed_at = pendingRedemptionResets.has(day1Key)
      ? ""
      : pendingRedemptions.has(day1Key)
        ? local.day1_redeemed_at || ""
        : remote.day1_redeemed_at || "";
    merged.day2_redeemed_at = pendingRedemptionResets.has(day2Key)
      ? ""
      : pendingRedemptions.has(day2Key)
        ? local.day2_redeemed_at || ""
        : remote.day2_redeemed_at || "";
    merged.dinner_redeemed_at = pendingRedemptionResets.has(dinnerKey)
      ? ""
      : pendingRedemptions.has(dinnerKey)
        ? local.dinner_redeemed_at || ""
        : remote.dinner_redeemed_at || "";
    merged.day1_scan_generation = pendingRedemptionResets.has(day1Key)
      ? local.day1_scan_generation || ""
      : remote.day1_scan_generation;
    merged.day2_scan_generation = pendingRedemptionResets.has(day2Key)
      ? local.day2_scan_generation || ""
      : remote.day2_scan_generation;
    merged.dinner_scan_generation = pendingRedemptionResets.has(dinnerKey)
      ? local.dinner_scan_generation || ""
      : remote.dinner_scan_generation;
    merged.day1_scan_reset_at = pendingRedemptionResets.has(day1Key)
      ? local.day1_scan_reset_at || ""
      : remote.day1_scan_reset_at;
    merged.day2_scan_reset_at = pendingRedemptionResets.has(day2Key)
      ? local.day2_scan_reset_at || ""
      : remote.day2_scan_reset_at;
    merged.dinner_scan_reset_at = pendingRedemptionResets.has(dinnerKey)
      ? local.dinner_scan_reset_at || ""
      : remote.dinner_scan_reset_at;
    merged.qr_token = local.qr_token || remote.qr_token;
    if (local.token_status === "REVOKED" || remote.token_status === "REVOKED") {
      merged.token_status = "REVOKED";
    }
    merged.sync_state = keepLocal ? local.sync_state || "PENDING" : "SYNCED";
    await dbPut("participants", merged);
  }

  for (const r of cloudRedemptions) {
    if (!r.participant_id || !r.session) continue;
    const key = `${r.participant_id}::${r.session}`;
    if (pendingRedemptionResets.has(key)) continue;
    const local = await dbGet("redemptions", key);
    if (!local) {
      await dbPut("redemptions", {
        dedupe_key: key,
        transaction_id: r.transaction_id,
        participant_id: r.participant_id,
        participant_name: r.participant_name || "",
        qr_token: r.qr_token || "",
        session: r.session,
        device_id: r.device_id || "",
        operator: r.operator || "",
        timestamp: r.timestamp || r.created_at,
        type: r.type || "SCAN",
        reason: r.reason || "",
        synced: true,
      });
    }
    const participant = await dbGet("participants", r.participant_id);
    if (participant && !participant[`${r.session}_redeemed`]) {
      await dbPut("participants", {
        ...participant,
        [`${r.session}_redeemed`]: true,
        [`${r.session}_redeemed_at`]: r.timestamp || r.created_at,
      });
    }
  }

  for (const redemption of await dbAll("redemptions")) {
    const key = `${redemption.participant_id}::${redemption.session}`;
    if (redemption.synced && !cloudRedemptionKeys.has(key) && !pendingRedemptions.has(key)) {
      await dbDelete("redemptions", redemption.dedupe_key);
    }
  }

  for (const t of cloudTokens) {
    if (!t.token) continue;
    const local = await dbGet("tokens", t.token);
    const cloud = {
      token: t.token,
      status: t.status || "UNUSED",
      batch: t.batch || "",
      assigned_participant_id: t.assigned_participant_id || "",
      assigned_at: t.assigned_at || "",
      assigned_by: t.assigned_by || "",
      created_at: t.created_at || "",
      created_by: t.created_by || "",
    };
    if (!local) {
      await dbPut("tokens", cloud);
    } else if (local.status === "ASSIGNED" && cloud.status !== "ASSIGNED") {
      await dbPut("tokens", { ...cloud, status: "ASSIGNED", assigned_participant_id: local.assigned_participant_id });
    } else if (local.status !== cloud.status || local.assigned_participant_id !== cloud.assigned_participant_id) {
      await dbPut("tokens", cloud);
    }
  }

  for (const s of cloudSettings) {
    if (s.key === "conference" && !pendingSettings.has("conference")) {
      try {
        await setMeta("conference", JSON.parse(s.value || "{}"));
        if (typeof window !== "undefined") window.dispatchEvent(new Event("buffetflow:conference-updated"));
      } catch {
        /* ignore malformed config */
      }
    }
    if (s.key === "duplicate_attempts_reset_at" && !pendingSettings.has("duplicate_attempts_reset_at")) {
      const remoteTime = Date.parse(s.value || "");
      const localTime = Date.parse(await getMeta("duplicateAttemptsResetAt", ""));
      if (Number.isFinite(remoteTime) && (!Number.isFinite(localTime) || remoteTime > localTime)) {
        await setMeta("duplicateAttemptsResetAt", s.value);
      }
    }
  }

  await dbClear("staff");
  for (const s of cloudStaff) {
    if (s.email) await dbPut("staff", { email: String(s.email).toLowerCase(), display_name: s.display_name || "", role: s.role || "registration" });
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("buffetflow:staff-updated"));

  const devices = cloudDevices
    .map((d) => ({
      device_id: d.device_id,
      name: d.name || d.device_id,
      role: d.role || "registration",
      operator: d.operator || "",
      last_pull_at: d.last_pull_at || "",
      last_push_at: d.last_push_at || "",
      participants_count: d.participants_count || 0,
    }))
    .sort((a, b) => new Date(b.last_pull_at || 0) - new Date(a.last_pull_at || 0));
  await setMeta("devices", devices);
  setState({ devices });
}

async function heartbeat() {
  const deviceId = getDeviceId();
  const participants = await dbAll("participants");
  const payload = {
    device_id: deviceId,
    name: getDeviceName(),
    role: (await getMeta("device_role", "registration")) || "registration",
    operator: (await getMeta("operator", "")) || "",
    last_pull_at: new Date().toISOString(),
    participants_count: participants.length,
    app_version: "1.0.0",
  };
  payload.last_push_at = payload.last_pull_at;
  await upsert("devices", payload, "device_id");
}

let inFlight = null;
let syncPaused = false;

const OPERATIONAL_OUTBOX_KINDS = new Set(["participant", "redemption", "redemption_reset", "token"]);

async function clearLocalOperationalData(resetAt) {
  await Promise.all([dbClear("participants"), dbClear("redemptions"), dbClear("tokens")]);
  const outbox = await dbAll("outbox");
  await Promise.all(
    outbox
      .filter((item) => OPERATIONAL_OUTBOX_KINDS.has(item.kind))
      .map((item) => dbDelete("outbox", item.id))
  );
  await setMeta("operationalResetAt", resetAt);
  await refreshPending();
}

async function applyRemoteOperationalReset() {
  const { data, error } = await getSupabaseClient()
    .from("app_settings")
    .select("value")
    .eq("key", "operational_reset_at")
    .maybeSingle();
  if (error) throw error;
  if (!data?.value) return;

  const remoteTime = Date.parse(data.value);
  const localTime = Date.parse(await getMeta("operationalResetAt", ""));
  if (Number.isFinite(remoteTime) && (!Number.isFinite(localTime) || remoteTime > localTime)) {
    await clearLocalOperationalData(data.value);
  }
}

export async function resetOperationalData() {
  syncPaused = true;
  try {
    if (inFlight) await inFlight;
    const { data, error } = await getSupabaseClient().rpc("reset_operational_data");
    if (error) throw error;
    if (!data?.reset_at || !data?.event_id) throw new Error("The server did not confirm the data reset.");
    await clearLocalOperationalData(data.reset_at);
    await dbPut("audits", {
      event_id: data.event_id,
      event_type: "OPERATIONAL_DATA_RESET",
      participant_id: "",
      device_id: getDeviceId(),
      actor: data.actor || "",
      timestamp: data.reset_at,
      session: "",
      outcome: "SUCCESS",
      reason: "",
      detail: `Deleted ${data.participants} participants, ${data.redemptions} redemptions, and ${data.reserve_tokens} reserve passes`,
      synced: true,
    });
    return data;
  } finally {
    syncPaused = false;
  }
}

export async function runSync(reason = "manual") {
  if (syncPaused) return state;
  if (inFlight) return inFlight;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    setState({ online: false, error: "This phone is offline. Work continues locally." });
    return state;
  }
  inFlight = (async () => {
    setState({ running: true, online: true, error: null, phase: "push" });
    try {
      await applyRemoteOperationalReset();
      await pushOutbox();
      setState({ phase: "pull" });
      await pullAll();
      await heartbeat();
      const now = new Date().toISOString();
      await setMeta("lastSync", now);
      setState({ lastSync: now, error: null, phase: "" });
    } catch (err) {
      setState({ error: String(err?.message || err) });
    } finally {
      await refreshPending();
      setState({ running: false, phase: "" });
      inFlight = null;
    }
    return state;
  })();
  return inFlight;
}

export async function initSyncState() {
  const [lastSync, devices] = await Promise.all([getMeta("lastSync", null), getMeta("devices", [])]);
  setState({
    lastSync,
    devices: devices || [],
    online: typeof navigator === "undefined" ? true : navigator.onLine,
  });
  await refreshPending();
}

let autoStarted = false;

export function startAutoSync() {
  if (autoStarted || typeof window === "undefined") return;
  autoStarted = true;
  window.addEventListener("online", () => {
    setState({ online: true });
    runSync("online");
  });
  window.addEventListener("offline", () => setState({ online: false, error: "This phone is offline. Work continues locally." }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) runSync("visible");
  });
  setInterval(() => {
    if (navigator.onLine && document.visibilityState === "visible") runSync("interval");
  }, 30000);
  initSyncState().then(() => runSync("launch"));
}

/* Has the buffet scanner actually received this participant? */
export function availabilityFor(participant, devices = [], selfDeviceId = null) {
  if (!participant) return "PENDING";
  if (participant.sync_state === "FAILED") return "FAILED";
  if (selfDeviceId) {
    const self = devices.find((d) => d.device_id === selfDeviceId);
    if (self && self.role === "buffet") return "AVAILABLE";
  }
  if (!participant.cloud_id) return "PENDING";
  const buffetDevices = devices.filter((d) => d.role === "buffet" && d.last_pull_at);
  if (!buffetDevices.length) return "PENDING";
  const newest = Math.max(...buffetDevices.map((d) => new Date(d.last_pull_at).getTime()));
  const created = new Date(participant.last_modified || participant.registration_timestamp || 0).getTime();
  return newest > created ? "AVAILABLE" : "PENDING";
}