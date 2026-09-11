import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { SignatureFieldRow, SignerRow } from "./types";

export async function getPdfPageCount(pdfBytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  return doc.getPageCount();
}

interface SignedSignerWithField {
  signer: SignerRow;
  field: SignatureFieldRow;
  signatureImageBytes: Uint8Array | null; // present when signer.signature_type === 'draw'
}

/**
 * Composites the pristine uploaded PDF with every signed field on demand.
 * The original PDF in R2 is never mutated, so concurrent (parallel) signers
 * never race on a shared object — each signature lives in its own DB row /
 * R2 object until this function stitches them together for viewing/download.
 */
export async function compositeSignedPdf(originalBytes: Uint8Array, signed: SignedSignerWithField[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalBytes);
  const pages = pdfDoc.getPages();
  const cursiveFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  for (const entry of signed) {
    const page = pages[entry.field.page_index];
    if (!page) continue;

    const { x, y, width, height } = entry.field;

    if (entry.signer.signature_type === "draw" && entry.signatureImageBytes) {
      const png = await pdfDoc.embedPng(entry.signatureImageBytes);
      const scaled = png.scaleToFit(width, height);
      page.drawImage(png, {
        x: x + (width - scaled.width) / 2,
        y: y + (height - scaled.height) / 2,
        width: scaled.width,
        height: scaled.height,
      });
    } else if (entry.signer.signature_type === "type" && entry.signer.typed_text) {
      const fontSize = Math.min(height * 0.7, 28);
      page.drawText(entry.signer.typed_text, {
        x: x + 4,
        y: y + (height - fontSize) / 2,
        size: fontSize,
        font: cursiveFont,
        color: rgb(0.1, 0.15, 0.55),
      });
    }

    // Thin baseline under the field so it's visually anchored on the page.
    page.drawLine({
      start: { x, y },
      end: { x: x + width, y },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
  }

  return pdfDoc.save();
}
