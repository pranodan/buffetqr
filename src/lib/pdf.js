import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/* Exports the rendered A4 slip sheets as a PDF at true size (no scaling). */
export async function downloadSlipPdf(container, filename = "qr-slips.pdf") {
  if (!container) return;
  const pages = Array.from(container.querySelectorAll(".slip-page"));
  if (!pages.length) return;
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i], {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });
    const image = canvas.toDataURL("image/jpeg", 0.94);
    if (i > 0) pdf.addPage();
    pdf.addImage(image, "JPEG", 8, 8, 194, 281);
  }
  pdf.save(filename);
}