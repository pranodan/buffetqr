/* Opens a print window with one slip at true size. */
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function printSingleSlip({ name, id, category, institution, qr }) {
  const win = window.open("", "_blank", "width=460,height=640");
  if (!win) return;
  win.document.write(`<!doctype html><html><head><title>QR slip ${esc(id)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 10mm; background: #fff; }
    .slip { width: 88mm; border: 0.3mm dashed #b5b5b5; padding: 6mm; display: flex; gap: 5mm; align-items: center; }
    img { width: 34mm; height: 34mm; display: block; }
    .n { font-size: 12pt; font-weight: 700; line-height: 1.2; }
    .m { font-size: 8.5pt; color: #333; margin-top: 1mm; }
    .hint { margin-top: 8mm; font-size: 9pt; color: #666; }
  </style></head><body>
  <div class="slip">
    <img src="${qr}" alt="QR" />
    <div>
      <div class="n">${esc(name)}</div>
      <div class="m">${esc(id)}</div>
      ${category ? `<div class="m">${esc(category)}</div>` : ""}
      ${institution ? `<div class="m">${esc(institution)}</div>` : ""}
    </div>
  </div>
  <p class="hint">Print at 100% scale. Cut on the dashed line.</p>
  <script>window.onload = function () { setTimeout(function () { window.print(); }, 250); };</script>
  </body></html>`);
  win.document.close();
}