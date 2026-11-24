const ID_KEY = "buffet_device_id";
const NAME_KEY = "buffet_device_name";

export function getDeviceId() {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = "dev_" + crypto.randomUUID().slice(0, 8);
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

export function getDeviceName() {
  if (typeof window === "undefined") return "Device";
  const saved = localStorage.getItem(NAME_KEY);
  if (saved) return saved;
  const ua = navigator.userAgent || "";
  if (/Android/i.test(ua)) return "Android phone";
  if (/iPhone|iPad/i.test(ua)) return "iPhone";
  return "Browser device";
}

export function setDeviceName(name) {
  if (typeof window === "undefined") return;
  localStorage.setItem(NAME_KEY, name || "");
}