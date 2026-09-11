import type {
  AuditLogRow,
  CreateEnvelopeInput,
  DocumentRow,
  Env,
  SignatureFieldRow,
  SignerRow,
} from "./types";

function newId(): string {
  return crypto.randomUUID();
}

function newToken(): string {
  // URL-safe, unguessable token for owner/signer links.
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createDocument(
  env: Env,
  input: CreateEnvelopeInput,
  documentId: string,
  pdfKey: string,
  pageCount: number
): Promise<{ document: DocumentRow; signers: SignerRow[]; fields: SignatureFieldRow[] }> {
  const ownerToken = newToken();
  const now = new Date().toISOString();

  const document: DocumentRow = {
    id: documentId,
    owner_token: ownerToken,
    title: input.title,
    pdf_key: pdfKey,
    page_count: pageCount,
    owner_name: input.ownerName,
    owner_email: input.ownerEmail,
    routing_mode: input.routingMode,
    status: "sent",
    created_at: now,
    completed_at: null,
  };

  const statements = [
    env.DB.prepare(
      `INSERT INTO documents (id, owner_token, title, pdf_key, page_count, owner_name, owner_email, routing_mode, status, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      document.id,
      document.owner_token,
      document.title,
      document.pdf_key,
      document.page_count,
      document.owner_name,
      document.owner_email,
      document.routing_mode,
      document.status,
      document.created_at,
      document.completed_at
    ),
  ];

  const signers: SignerRow[] = [];
  const fields: SignatureFieldRow[] = [];

  input.signers.forEach((signerInput, index) => {
    const signerId = newId();
    const signToken = newToken();
    const signer: SignerRow = {
      id: signerId,
      document_id: documentId,
      name: signerInput.name,
      email: signerInput.email,
      sign_token: signToken,
      order_index: index,
      status: "pending",
      signature_type: null,
      typed_text: null,
      signature_image_key: null,
      signed_at: null,
      decline_reason: null,
    };
    signers.push(signer);
    statements.push(
      env.DB.prepare(
        `INSERT INTO signers (id, document_id, name, email, sign_token, order_index, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`
      ).bind(signer.id, signer.document_id, signer.name, signer.email, signer.sign_token, signer.order_index)
    );

    const field: SignatureFieldRow = {
      id: newId(),
      document_id: documentId,
      signer_id: signerId,
      page_index: signerInput.field.pageIndex,
      x: signerInput.field.x,
      y: signerInput.field.y,
      width: signerInput.field.width,
      height: signerInput.field.height,
    };
    fields.push(field);
    statements.push(
      env.DB.prepare(
        `INSERT INTO signature_fields (id, document_id, signer_id, page_index, x, y, width, height)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(field.id, field.document_id, field.signer_id, field.page_index, field.x, field.y, field.width, field.height)
    );
  });

  statements.push(
    env.DB.prepare(
      `INSERT INTO audit_log (id, document_id, signer_id, event_type, detail) VALUES (?, ?, NULL, 'created', ?)`
    ).bind(newId(), documentId, `Envelope created with ${signers.length} signer(s), routing=${input.routingMode}`)
  );
  statements.push(
    env.DB.prepare(`INSERT INTO audit_log (id, document_id, signer_id, event_type, detail) VALUES (?, ?, NULL, 'sent', NULL)`).bind(
      newId(),
      documentId
    )
  );

  await env.DB.batch(statements);

  return { document, signers, fields };
}

export async function getDocumentByOwnerToken(env: Env, ownerToken: string): Promise<DocumentRow | null> {
  const row = await env.DB.prepare(`SELECT * FROM documents WHERE owner_token = ?`).bind(ownerToken).first<DocumentRow>();
  return row ?? null;
}

export async function getDocumentById(env: Env, documentId: string): Promise<DocumentRow | null> {
  const row = await env.DB.prepare(`SELECT * FROM documents WHERE id = ?`).bind(documentId).first<DocumentRow>();
  return row ?? null;
}

export async function listSignersByDocumentId(env: Env, documentId: string): Promise<SignerRow[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM signers WHERE document_id = ? ORDER BY order_index ASC`)
    .bind(documentId)
    .all<SignerRow>();
  return results ?? [];
}

export async function listFieldsByDocumentId(env: Env, documentId: string): Promise<SignatureFieldRow[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM signature_fields WHERE document_id = ?`).bind(documentId).all<SignatureFieldRow>();
  return results ?? [];
}

export async function listAuditLogByDocumentId(env: Env, documentId: string): Promise<AuditLogRow[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM audit_log WHERE document_id = ? ORDER BY created_at ASC`)
    .bind(documentId)
    .all<AuditLogRow>();
  return results ?? [];
}

export async function getSignerByToken(env: Env, signToken: string): Promise<SignerRow | null> {
  const row = await env.DB.prepare(`SELECT * FROM signers WHERE sign_token = ?`).bind(signToken).first<SignerRow>();
  return row ?? null;
}

export async function getFieldForSigner(env: Env, signerId: string): Promise<SignatureFieldRow | null> {
  const row = await env.DB.prepare(`SELECT * FROM signature_fields WHERE signer_id = ?`).bind(signerId).first<SignatureFieldRow>();
  return row ?? null;
}

export async function markSignerViewed(env: Env, signer: SignerRow, ip: string | null, userAgent: string | null): Promise<void> {
  if (signer.status !== "pending") return;
  await env.DB.batch([
    env.DB.prepare(`UPDATE signers SET status = 'viewed' WHERE id = ?`).bind(signer.id),
    env.DB.prepare(
      `INSERT INTO audit_log (id, document_id, signer_id, event_type, ip, user_agent) VALUES (?, ?, ?, 'viewed', ?, ?)`
    ).bind(newId(), signer.document_id, signer.id, ip, userAgent),
  ]);
}

export async function recordSignature(
  env: Env,
  signer: SignerRow,
  params: { signatureType: "draw" | "type"; typedText: string | null; signatureImageKey: string | null },
  ip: string | null,
  userAgent: string | null
): Promise<{ allSigned: boolean; document: DocumentRow }> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE signers SET status = 'signed', signature_type = ?, typed_text = ?, signature_image_key = ?, signed_at = ? WHERE id = ?`
    ).bind(params.signatureType, params.typedText, params.signatureImageKey, now, signer.id),
    env.DB.prepare(
      `INSERT INTO audit_log (id, document_id, signer_id, event_type, ip, user_agent) VALUES (?, ?, ?, 'signed', ?, ?)`
    ).bind(newId(), signer.document_id, signer.id, ip, userAgent),
  ]);

  const remaining = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM signers WHERE document_id = ? AND status != 'signed'`
  )
    .bind(signer.document_id)
    .first<{ count: number }>();

  const allSigned = (remaining?.count ?? 1) === 0;
  let document = await getDocumentById(env, signer.document_id);
  if (!document) throw new Error("document not found after signing");

  if (allSigned && document.status !== "completed") {
    await env.DB.batch([
      env.DB.prepare(`UPDATE documents SET status = 'completed', completed_at = ? WHERE id = ?`).bind(now, document.id),
      env.DB.prepare(`INSERT INTO audit_log (id, document_id, signer_id, event_type) VALUES (?, ?, NULL, 'completed')`).bind(
        newId(),
        document.id
      ),
    ]);
    document = { ...document, status: "completed", completed_at: now };
  }

  return { allSigned, document };
}

export async function declineSigner(
  env: Env,
  signer: SignerRow,
  reason: string,
  ip: string | null,
  userAgent: string | null
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`UPDATE signers SET status = 'declined', decline_reason = ? WHERE id = ?`).bind(reason, signer.id),
    env.DB.prepare(
      `INSERT INTO audit_log (id, document_id, signer_id, event_type, detail, ip, user_agent) VALUES (?, ?, ?, 'declined', ?, ?, ?)`
    ).bind(newId(), signer.document_id, signer.id, reason, ip, userAgent),
    env.DB.prepare(`UPDATE documents SET status = 'voided' WHERE id = ?`).bind(signer.document_id),
  ]);
}

export { newId, newToken };
