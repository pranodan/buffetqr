import { dbAll } from "@/lib/db";

export const ROLE_LABELS = {
  admin: "Super admin",
  registration: "Registration desk",
  buffet: "Buffet operator",
};

const PERMISSIONS = {
  admin: [
    "dashboard",
    "scanner",
    "register",
    "participants",
    "slips",
    "import",
    "reserve",
    "exception",
    "reports",
    "audit",
    "sync",
    "settings",
  ],
  registration: ["dashboard", "register", "participants", "slips", "sync"],
  buffet: ["dashboard", "scanner", "sync"],
};

export async function resolveRole(user) {
  if (!user) return "buffet";
  if (["admin", "registration", "buffet"].includes(user.role)) return user.role;
  const staff = await dbAll("staff");
  const email = String(user.email || "").toLowerCase();
  const record = staff.find((s) => String(s.email || "").toLowerCase() === email);
  return record?.role || "registration";
}

export function can(role, permission) {
  return (PERMISSIONS[role] || []).includes(permission);
}

export function landingFor(role) {
  if (role === "buffet") return "/scanner";
  if (role === "registration") return "/spot";
  return "/";
}