import { Hono } from "hono";
import {
  declineSigner,
  getDocumentById,
  getFieldForSigner,
  getSignerByToken,
  listSignersByDocumentId,
  markSignerViewed,
  newId,
  recordSignature,
} from "../db";
import { renderComposite } from "./documents";
import { sendCompletionEmailToOwner, sendCompletionEmailToSigner, sendSignRequestEmail } from "../email";
import type { DocumentRow, Env, SignerRow } from "../types";

export const signRoute = new Hono<{ Bindings: Env }>();

/** Fires the right notification(s) after a signature is recorded, without blocking the response. */
function notifyAfterSignature(c: { env: Env; executionCtx: { waitUntil: (p: Promise<unknown>) => void } }, document: DocumentRow) {
  c.executionCtx.waitUntil(
    (async () => {
      const signers = await listSignersByDocumentId(c.env, document.id);
      if (document.status === "completed") {
        await Promise.all([
          sendCompletionEmailToOwner(c.env, document),
          ...signers.map((s) => sendCompletionEmailToSigner(c.env, document, s)),
        ]);
      } else if (document.routing_mode === "sequential") {
        const next = signers.filter((s) => s.status === "pending" || s.status === "viewed").sort((a, b) => a.order_index - b.order_index)[0];
        if (next) await sendSignRequestEmail(c.env, document, next);
      }
    })()
  );
}

function clientMeta(c: { req: { header: (name: string) => string | undefined } }) {
  return { ip: c.req.header("CF-Connecting-IP") ?? null, userAgent: c.req.header("User-Agent") ?? null };
}

async function isSignersTurn(env: Env, signer: SignerRow): Promise<{ ok: boolean; waitingOnName?: string }> {
  const document = await getDocumentById(env, signer.document_id);
  if (!document) return { ok: false };
  if (document.routing_mode === "parallel") return { ok: true };

  const signers = await listSignersByDocumentId(env, signer.document_id);
  const blocker = signers.find((s) => s.order_index < signer.order_index && s.status !== "signed");
  if (blocker) return { ok: false, waitingOnName: blocker.name };
  return { ok: true };
}

signRoute.get("/:token", async (c) => {
  const signer = await getSignerByToken(c.env, c.req.param("token"));
  if (!signer) return c.json({ error: "Not found" }, 404);

  const [document, field, turn] = await Promise.all([
    getDocumentById(c.env, signer.document_id),
    getFieldForSigner(c.env, signer.id),
    isSignersTurn(c.env, signer),
  ]);
  if (!document || !field) return c.json({ error: "Not found" }, 404);

  if (signer.status === "pending" && turn.ok) {
    const { ip, userAgent } = clientMeta(c);
    await markSignerViewed(c.env, signer, ip, userAgent);
    signer.status = "viewed";
  }

  return c.json({
    document: { title: document.title, pageCount: document.page_count, routingMode: document.routing_mode, status: document.status },
    signer: { name: signer.name, email: signer.email, status: signer.status, declineReason: signer.decline_reason },
    field,
    canSign: turn.ok && signer.status !== "signed" && signer.status !== "declined" && document.status !== "voided",
    waitingOnName: turn.waitingOnName ?? null,
  });
});

signRoute.get("/:token/pdf", async (c) => {
  const signer = await getSignerByToken(c.env, c.req.param("token"));
  if (!signer) return c.json({ error: "Not found" }, 404);
  const document = await getDocumentById(c.env, signer.document_id);
  if (!document) return c.json({ error: "Not found" }, 404);

  const pdf = await renderComposite(c.env, document.id, document.pdf_key);
  if (!pdf) return c.json({ error: "Could not load PDF" }, 500);

  return new Response(pdf as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline" } });
});

signRoute.post("/:token", async (c) => {
  const signer = await getSignerByToken(c.env, c.req.param("token"));
  if (!signer) return c.json({ error: "Not found" }, 404);
  if (signer.status === "signed") return c.json({ error: "Already signed" }, 409);
  if (signer.status === "declined") return c.json({ error: "This signer already declined" }, 409);

  const turn = await isSignersTurn(c.env, signer);
  if (!turn.ok) return c.json({ error: `Waiting on ${turn.waitingOnName ?? "a prior signer"} to sign first` }, 409);

  const body = await c.req.json<{ signatureType: "draw" | "type"; typedText?: string; imageDataUrl?: string }>();
  const { ip, userAgent } = clientMeta(c);

  if (body.signatureType === "type") {
    if (!body.typedText?.trim()) return c.json({ error: "Typed signature text is required" }, 400);
    const result = await recordSignature(
      c.env,
      signer,
      { signatureType: "type", typedText: body.typedText.trim(), signatureImageKey: null },
      ip,
      userAgent
    );
    notifyAfterSignature(c, result.document);
    return c.json({ allSigned: result.allSigned, documentStatus: result.document.status });
  }

  if (body.signatureType === "draw") {
    if (!body.imageDataUrl?.startsWith("data:image/png;base64,")) return c.json({ error: "A drawn signature image is required" }, 400);
    const base64 = body.imageDataUrl.slice("data:image/png;base64,".length);
    const pngBytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
    if (pngBytes.length > 2 * 1024 * 1024) return c.json({ error: "Signature image too large" }, 400);

    const signatureImageKey = `signatures/${signer.id}-${newId()}.png`;
    await c.env.DOCS.put(signatureImageKey, pngBytes);

    const result = await recordSignature(c.env, signer, { signatureType: "draw", typedText: null, signatureImageKey }, ip, userAgent);
    notifyAfterSignature(c, result.document);
    return c.json({ allSigned: result.allSigned, documentStatus: result.document.status });
  }

  return c.json({ error: "signatureType must be 'draw' or 'type'" }, 400);
});

signRoute.post("/:token/decline", async (c) => {
  const signer = await getSignerByToken(c.env, c.req.param("token"));
  if (!signer) return c.json({ error: "Not found" }, 404);
  if (signer.status === "signed" || signer.status === "declined") return c.json({ error: "Cannot decline now" }, 409);

  const body = await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined }));
  const { ip, userAgent } = clientMeta(c);
  await declineSigner(c.env, signer, body.reason?.trim() || "No reason given", ip, userAgent);
  return c.json({ ok: true });
});
