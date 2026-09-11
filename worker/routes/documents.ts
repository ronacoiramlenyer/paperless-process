import { Hono } from "hono";
import { getPdfPageCount, compositeSignedPdf } from "../pdf";
import {
  createDocument,
  getDocumentByOwnerToken,
  listAuditLogByDocumentId,
  listFieldsByDocumentId,
  listSignersByDocumentId,
  newId,
} from "../db";
import type { CreateEnvelopeInput, Env } from "../types";

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20MB

export const documentsRoute = new Hono<{ Bindings: Env }>();

documentsRoute.post("/", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  const metaRaw = form.get("meta");

  if (!(file instanceof File)) return c.json({ error: "Missing PDF file" }, 400);
  if (typeof metaRaw !== "string") return c.json({ error: "Missing meta" }, 400);
  if (file.size > MAX_PDF_BYTES) return c.json({ error: "PDF exceeds 20MB limit" }, 400);
  if (file.type && file.type !== "application/pdf") return c.json({ error: "File must be a PDF" }, 400);

  let input: CreateEnvelopeInput;
  try {
    input = JSON.parse(metaRaw);
  } catch {
    return c.json({ error: "meta must be valid JSON" }, 400);
  }

  if (!input.title?.trim()) return c.json({ error: "Title is required" }, 400);
  if (!input.ownerName?.trim() || !input.ownerEmail?.trim()) return c.json({ error: "Owner name/email required" }, 400);
  if (input.routingMode !== "parallel" && input.routingMode !== "sequential") return c.json({ error: "Invalid routing mode" }, 400);
  if (!Array.isArray(input.signers) || input.signers.length === 0) return c.json({ error: "At least one signer is required" }, 400);
  for (const s of input.signers) {
    if (!s.name?.trim() || !s.email?.trim() || !s.field) return c.json({ error: "Every signer needs a name, email and placed field" }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  let pageCount: number;
  try {
    pageCount = await getPdfPageCount(bytes);
  } catch {
    return c.json({ error: "Could not read PDF (is it valid?)" }, 400);
  }

  for (const s of input.signers) {
    if (s.field.pageIndex < 0 || s.field.pageIndex >= pageCount) {
      return c.json({ error: `Signature field for ${s.name} references an invalid page` }, 400);
    }
  }

  const documentId = newId();
  const pdfKey = `documents/${documentId}.pdf`;
  await c.env.DOCS.put(pdfKey, bytes, { httpMetadata: { contentType: "application/pdf" } });

  const { document, signers } = await createDocument(c.env, input, documentId, pdfKey, pageCount);

  const base = c.env.APP_BASE_URL.replace(/\/$/, "");
  return c.json({
    ownerUrl: `${base}/owner/${document.owner_token}`,
    signerUrls: signers.map((s) => ({ name: s.name, email: s.email, url: `${base}/sign/${s.sign_token}` })),
  });
});

documentsRoute.get("/:ownerToken", async (c) => {
  const document = await getDocumentByOwnerToken(c.env, c.req.param("ownerToken"));
  if (!document) return c.json({ error: "Not found" }, 404);

  const [signers, fields, auditLog] = await Promise.all([
    listSignersByDocumentId(c.env, document.id),
    listFieldsByDocumentId(c.env, document.id),
    listAuditLogByDocumentId(c.env, document.id),
  ]);

  const base = c.env.APP_BASE_URL.replace(/\/$/, "");
  return c.json({
    document,
    signers: signers.map((s) => ({ ...s, signUrl: `${base}/sign/${s.sign_token}` })),
    fields,
    auditLog,
  });
});

documentsRoute.get("/:ownerToken/pdf", async (c) => {
  const document = await getDocumentByOwnerToken(c.env, c.req.param("ownerToken"));
  if (!document) return c.json({ error: "Not found" }, 404);

  const pdf = await renderComposite(c.env, document.id, document.pdf_key);
  if (!pdf) return c.json({ error: "Could not load PDF" }, 500);

  const download = c.req.query("download") === "1";
  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${document.title.replace(/[^\w.-]+/g, "_")}.pdf"`,
    },
  });
});

export async function renderComposite(env: Env, documentId: string, pdfKey: string): Promise<Uint8Array | null> {
  const [obj, signers, fields] = await Promise.all([
    env.DOCS.get(pdfKey),
    listSignersByDocumentId(env, documentId),
    listFieldsByDocumentId(env, documentId),
  ]);
  if (!obj) return null;
  const originalBytes = new Uint8Array(await obj.arrayBuffer());

  const fieldBySignerId = new Map(fields.map((f) => [f.signer_id, f]));
  const signed = await Promise.all(
    signers
      .filter((s) => s.status === "signed")
      .map(async (signer) => {
        const field = fieldBySignerId.get(signer.id);
        if (!field) return null;
        let signatureImageBytes: Uint8Array | null = null;
        if (signer.signature_type === "draw" && signer.signature_image_key) {
          const imgObj = await env.DOCS.get(signer.signature_image_key);
          if (imgObj) signatureImageBytes = new Uint8Array(await imgObj.arrayBuffer());
        }
        return { signer, field, signatureImageBytes };
      })
  );

  return compositeSignedPdf(
    originalBytes,
    signed.filter((s): s is NonNullable<typeof s> => s !== null)
  );
}
