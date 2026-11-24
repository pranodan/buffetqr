/* CSV parsing and export helpers. */

export function parseCsv(text) {
  const clean = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      /* ignore */
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);

  const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ""));
  if (!nonEmpty.length) return { headers: [], records: [] };

  const headers = nonEmpty[0].map((h) => String(h).trim().toLowerCase().replace(/\s+/g, "_"));
  const records = nonEmpty.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = String(r[idx] ?? "").trim();
    });
    return obj;
  });
  return { headers, records };
}

function escapeCell(value) {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, headers) {
  const cols = headers || Object.keys(rows[0] || {});
  const lines = [cols.join(",")];
  rows.forEach((row) => {
    lines.push(cols.map((c) => escapeCell(row[c])).join(","));
  });
  return lines.join("\r\n");
}

export function downloadText(filename, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function parseBoolean(value, fallback = true) {
  const v = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "y", "day1", "day2", "eligible"].includes(v)) return true;
  if (["0", "false", "no", "n", "x", ""].includes(v)) return v === "" ? fallback : false;
  return fallback;
}