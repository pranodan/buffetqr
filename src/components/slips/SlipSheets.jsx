/* A4 sheets of QR slips plus a PDF export of the same sheets. */

export const SLIP_COUNTS = [6, 9, 12];

const PAGE_LAYOUTS = {
  6: { columns: 2, rows: 3, qrSize: 55, nameSize: "12pt", padding: "4mm 3mm", gap: 3 },
  9: { columns: 3, rows: 3, qrSize: 48, nameSize: "10pt", padding: "3mm 2mm", gap: 2.5 },
  12: { columns: 3, rows: 4, qrSize: 38, nameSize: "8.5pt", padding: "2mm", gap: 2 },
};

function getPageLayout(perPage) {
  const requested = Number(perPage);
  const count = PAGE_LAYOUTS[requested] ? requested : 6;
  return { count, ...PAGE_LAYOUTS[count] };
}

export default function SlipSheets({ items, qrMap, showId = true, showCategory = true, perPage = 6 }) {
  const layout = getPageLayout(perPage);
  const pages = [];
  for (let i = 0; i < items.length; i += layout.count) pages.push(items.slice(i, i + layout.count));

  return (
    <div id="slip-sheets" className="space-y-6">
      {pages.map((page, pageIndex) => (
        <div
          key={pageIndex}
          className="slip-page shadow-[0_2px_18px_rgba(0,0,0,0.08)]"
          style={{
            gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
            "--slip-qr-size": `${layout.qrSize}mm`,
            "--slip-name-size": layout.nameSize,
            "--slip-padding": layout.padding,
            "--slip-gap": `${layout.gap}mm`,
          }}
        >
          {page.map((item) => (
            <div className="slip" key={item.key}>
              <div className="slip-qr">
                {qrMap[item.key] ? <img src={qrMap[item.key]} alt={`QR code for ${item.name}`} /> : null}
              </div>
              <div className="slip-content">
                <div className="slip-name">{item.name}</div>
                {showId ? <div className="slip-id">{item.id}</div> : null}
                {showCategory && item.category ? <div className="slip-meta">{item.category}</div> : null}
                {item.institution ? <div className="slip-meta">{item.institution}</div> : null}
                {item.writeName ? <div className="slip-write-line" aria-label="Write name here" /> : null}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function pageCount(itemCount, perPage = 6) {
  return Math.ceil(itemCount / getPageLayout(perPage).count);
}