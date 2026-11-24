import QRCode from "qrcode";

/* Bundled locally (no CDN, no paid QR service). Black on white, quiet zone included. */
export function qrDataUrl(text, width = 480) {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 2,
    width,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

export async function qrDataUrls(list, width = 420) {
  const out = {};
  for (const item of list) {
    out[item.key] = await qrDataUrl(item.value, width);
  }
  return out;
}