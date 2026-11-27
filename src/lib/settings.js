import { getMeta, setMeta } from "@/lib/db";
import { queue } from "@/lib/sync";

export const DEFAULT_CONFERENCE = {
  name: "Nepal Medical Conference 2026",
  day1_name: "Day 1 buffet",
  day2_name: "Day 2 buffet",
  dinner_name: "Dinner",
  day1_date: "2026-11-27",
  day2_date: "2026-11-28",
  dinner_date: "2026-11-28",
  day1_enabled: true,
  day2_enabled: true,
  dinner_enabled: true,
  active_session: "day1",
  auto_scan: true,
};

export const DEFAULT_PREFS = {
  active_session: "day1",
  audio_enabled: true,
};

export async function getConference() {
  const stored = await getMeta("conference", null);
  return { ...DEFAULT_CONFERENCE, ...(stored || {}) };
}

export async function saveConference(next, { push = true } = {}) {
  const config = { ...DEFAULT_CONFERENCE, ...next };
  await setMeta("conference", config);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("buffetflow:conference-updated"));
  if (push) await queue("setting", { key: "conference", value: JSON.stringify(config) });
  return config;
}

export async function getPrefs() {
  const stored = await getMeta("prefs", null);
  return { ...DEFAULT_PREFS, ...(stored || {}) };
}

export async function savePrefs(patch) {
  const next = { ...(await getPrefs()), ...patch };
  await setMeta("prefs", next);
  return next;
}

export function sessionLabel(conference, session) {
  if (!conference) return session === "day2" ? "Day 2" : "Day 1";
  if (session === "dinner") return conference.dinner_name || "Dinner";
  return session === "day2" ? conference.day2_name : conference.day1_name;
}