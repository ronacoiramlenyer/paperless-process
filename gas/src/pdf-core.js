// Bundled into gas/Pdf.generated.js by build.mjs. Ported from the Cloudflare
// version's worker/pdf.ts - same logic, same pdf-lib calls. Works purely in
// terms of Uint8Array in/out; base64<->bytes conversion happens outside this
// bundle in plain Apps Script code (Pdf.js) via Utilities.base64Encode/Decode,
// since pdf-lib itself never touches atob/btoa (verified by inspecting the
// bundle - only test-harness code referenced them during prototyping).
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

async function getPageCount(originalBytes) {
  const doc = await PDFDocument.load(originalBytes, { updateMetadata: false });
  return doc.getPageCount();
}

/**
 * signed: array of {
 *   pageIndex, x, y, width, height,
 *   signatureType: 'draw' | 'upload' | 'type',
 *   typedText: string | null,
 *   signatureImageBytes: Uint8Array | null,
 *   signatureImageMimeType: 'image/png' | 'image/jpeg' | null,
 * }
 * 'draw' (canvas) is always PNG. 'upload' (a signer's own signature image
 * file) can be PNG or JPEG - signatureImageMimeType says which so the right
 * pdf-lib embed call is used.
 */
async function compositeSignedPdf(originalBytes, signed) {
  const pdfDoc = await PDFDocument.load(originalBytes);
  const pages = pdfDoc.getPages();
  const cursiveFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  for (const entry of signed) {
    const page = pages[entry.pageIndex];
    if (!page) continue;
    const { x, y, width, height } = entry;

    if ((entry.signatureType === "draw" || entry.signatureType === "upload") && entry.signatureImageBytes) {
      const isJpeg = entry.signatureImageMimeType === "image/jpeg" || entry.signatureImageMimeType === "image/jpg";
      const image = isJpeg ? await pdfDoc.embedJpg(entry.signatureImageBytes) : await pdfDoc.embedPng(entry.signatureImageBytes);
      const scaled = image.scaleToFit(width, height);
      page.drawImage(image, {
        x: x + (width - scaled.width) / 2,
        y: y + (height - scaled.height) / 2,
        width: scaled.width,
        height: scaled.height,
      });
    } else if (entry.signatureType === "type" && entry.typedText) {
      const fontSize = Math.min(height * 0.7, 28);
      page.drawText(entry.typedText, {
        x: x + 4,
        y: y + (height - fontSize) / 2,
        size: fontSize,
        font: cursiveFont,
        color: rgb(0.1, 0.15, 0.55),
      });
    }

    page.drawLine({
      start: { x, y },
      end: { x: x + width, y },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
  }

  return pdfDoc.save();
}

globalThis.PdfCore = { getPageCount, compositeSignedPdf };
