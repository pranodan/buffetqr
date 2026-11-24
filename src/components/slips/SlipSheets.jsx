/* A4 sheets of six QR slips (2 columns x 3 rows) plus a PDF export of the same sheets. */

export default function SlipSheets({ items, qrMap, showId = true, showCategory = true }) {
  const pages = [];
  for (let i = 0; i < items.length; i += 6) pages.push(items.slice(i, i + 6));

  return (
    <div id="slip-sheets" className="space-y-6">
      {pages.map((page, pageIndex) => (
        <div key={pageIndex} className="slip-page shadow-[0_2px_18px_rgba(0,0,0,0.08)]">
          {page.map((item) => (
            <div className="slip" key={item.key}>
              <div className="slip-qr">
                {qrMap[item.key] ? <img src={qrMap[item.key]} alt={`QR code for ${item.name}`} /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="slip-name">{item.name}</div>
                {showId ? <div className="slip-id">{item.id}</div> : null}
                {showCategory && item.category ? <div className="slip-meta">{item.category}</div> : null}
                {item.institution ? <div className="slip-meta">{item.institution}</div> : null}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function pageCount(itemCount) {
  return Math.ceil(itemCount / 6);
}