/**
 * Server functions called from the client via google.script.run. Every
 * function here re-derives the caller's identity from
 * Session.getActiveUser().getEmail() and checks it against the Documents /
 * Signers sheet - never trusts a client-supplied "I am the owner" claim.
 * Google's own sign-in (appsscript.json: access "DOMAIN") already guarantees
 * every caller is a verified lsgh.edu.ph account before any of this runs.
 */

var MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB - conservative headroom under google.script.run's payload limits once base64-inflated (~33%)

function currentUserEmail_() {
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Could not verify your identity. Please reload and make sure you're signed in.");
  return email;
}

function isSignersTurn_(document, signer) {
  if (document.routingMode === "parallel") return { ok: true };
  var signers = listSignersByDocumentId(document.id);
  var blocker = signers.filter(function (s) { return s.orderIndex < signer.orderIndex && s.status !== "signed"; })[0];
  if (blocker) return { ok: false, waitingOnName: blocker.name };
  return { ok: true };
}

function notifyAfterSignature_(document) {
  var signers = listSignersByDocumentId(document.id);
  if (document.status === "completed") {
    sendCompletionEmailToOwner(document);
    signers.forEach(function (s) { sendCompletionEmailToSigner(document, s); });
  } else if (document.routingMode === "sequential") {
    var next = signers
      .filter(function (s) { return s.status === "pending" || s.status === "viewed"; })
      .sort(function (a, b) { return a.orderIndex - b.orderIndex; })[0];
    if (next) sendSignRequestEmail(document, next);
  }
}

/**
 * pdfBase64: base64-encoded PDF bytes (client reads the File via FileReader
 * and strips the data: URL prefix before calling this).
 * meta: { title, ownerName, routingMode, signers: [{ name, email, field }] }
 * ownerEmail is always taken from the verified session, never from `meta`.
 */
async function createEnvelope(pdfBase64, meta) {
  var ownerEmail = currentUserEmail_();

  if (!meta || !meta.title || !String(meta.title).trim()) throw new Error("Title is required");
  if (!meta.ownerName || !String(meta.ownerName).trim()) throw new Error("Your name is required");
  if (meta.routingMode !== "parallel" && meta.routingMode !== "sequential") throw new Error("Invalid routing mode");
  if (!meta.signers || meta.signers.length === 0) throw new Error("At least one signer is required");
  meta.signers.forEach(function (s) {
    if (!s.name || !String(s.name).trim() || !s.email || !String(s.email).trim() || !s.field) {
      throw new Error("Every signer needs a name, email and placed field");
    }
  });

  var pdfBytes = base64ToBytes_(pdfBase64);
  if (pdfBytes.length > MAX_PDF_BYTES) throw new Error("PDF exceeds the 10MB limit");

  var pageCount = await getPdfPageCount(pdfBytes);
  meta.signers.forEach(function (s) {
    if (s.field.pageIndex < 0 || s.field.pageIndex >= pageCount) {
      throw new Error("Signature field for " + s.name + " references an invalid page");
    }
  });

  var documentId = newId_();
  var driveFileId = saveBytesToDrive_(pdfBytes, meta.title + ".pdf", "application/pdf");

  var input = {
    title: String(meta.title).trim(),
    ownerName: String(meta.ownerName).trim(),
    ownerEmail: ownerEmail,
    routingMode: meta.routingMode,
    signers: meta.signers.map(function (s) {
      return { name: String(s.name).trim(), email: String(s.email).trim(), field: s.field };
    }),
  };

  var created = createDocument(input, documentId, driveFileId, pageCount);

  var signersToNotify = created.document.routingMode === "parallel"
    ? created.signers
    : created.signers.filter(function (s) { return s.orderIndex === 0; });
  signersToNotify.forEach(function (s) { sendSignRequestEmail(created.document, s); });

  return { documentId: documentId, ownerUrl: webAppUrl_() + "?page=owner&doc=" + encodeURIComponent(documentId) };
}

function getOwnerDashboard(documentId) {
  var email = currentUserEmail_();
  var document = getDocumentById(documentId);
  if (!document) throw new Error("Document not found");
  if (String(document.ownerEmail).toLowerCase() !== email.toLowerCase()) {
    throw new Error("You're not the owner of this document.");
  }
  return {
    document: document,
    signers: listSignersByDocumentId(documentId),
    fields: listFieldsByDocumentId(documentId),
    auditLog: listAuditLogByDocumentId(documentId),
  };
}

function getSignSession(documentId) {
  var email = currentUserEmail_();
  var document = getDocumentById(documentId);
  if (!document) throw new Error("Document not found");
  var signer = getSignerForDocumentByEmail(documentId, email);
  if (!signer) throw new Error("You're not listed as a signer on this document (" + email + ").");

  var field = getFieldForSigner(signer.id);
  var turn = isSignersTurn_(document, signer);

  if (signer.status === "pending" && turn.ok) {
    markSignerViewed(signer, email);
    signer = getSignerForDocumentByEmail(documentId, email); // re-read fresh status
  }

  return {
    document: { id: document.id, title: document.title, pageCount: document.pageCount, routingMode: document.routingMode, status: document.status },
    signer: { name: signer.name, email: signer.email, status: signer.status, declineReason: signer.declineReason },
    field: field,
    canSign: turn.ok && signer.status !== "signed" && signer.status !== "declined" && document.status !== "voided",
    waitingOnName: turn.waitingOnName || null,
  };
}

/** Used by both the owner dashboard (preview/download) and the signer view (context while signing). */
async function getPdfBytesForDownload(documentId) {
  var email = currentUserEmail_();
  var document = getDocumentById(documentId);
  if (!document) throw new Error("Document not found");
  var isOwner = String(document.ownerEmail).toLowerCase() === email.toLowerCase();
  var isSigner = !!getSignerForDocumentByEmail(documentId, email);
  if (!isOwner && !isSigner) throw new Error("You don't have access to this document.");

  var bytes = await compositeSignedPdfForDocument(documentId);
  return bytesToBase64_(bytes);
}

/**
 * signatureType: 'draw' | 'type'
 * typedText: string (for 'type')
 * signatureImageBase64: base64 PNG (for 'draw')
 */
function submitSignature(documentId, signatureType, typedText, signatureImageBase64) {
  var email = currentUserEmail_();
  var document = getDocumentById(documentId);
  if (!document) throw new Error("Document not found");
  var signer = getSignerForDocumentByEmail(documentId, email);
  if (!signer) throw new Error("You're not listed as a signer on this document.");
  if (signer.status === "signed") throw new Error("Already signed");
  if (signer.status === "declined") throw new Error("You already declined this document");

  var turn = isSignersTurn_(document, signer);
  if (!turn.ok) throw new Error("Waiting on " + (turn.waitingOnName || "a prior signer") + " to sign first");

  var params = { signatureType: signatureType, typedText: null, signatureImageFileId: null };

  if (signatureType === "type") {
    if (!typedText || !String(typedText).trim()) throw new Error("Typed signature text is required");
    params.typedText = String(typedText).trim();
  } else if (signatureType === "draw") {
    if (!signatureImageBase64) throw new Error("A drawn signature image is required");
    var pngBytes = base64ToBytes_(signatureImageBase64);
    if (pngBytes.length > 2 * 1024 * 1024) throw new Error("Signature image too large");
    params.signatureImageFileId = saveBytesToDrive_(pngBytes, "signature-" + signer.id + ".png", "image/png");
  } else {
    throw new Error("signatureType must be 'draw' or 'type'");
  }

  var result = recordSignature(signer, params, email);
  notifyAfterSignature_(result.document);
  return { allSigned: result.allSigned, documentStatus: result.document.status };
}

function declineSignature(documentId, reason) {
  var email = currentUserEmail_();
  var signer = getSignerForDocumentByEmail(documentId, email);
  if (!signer) throw new Error("You're not listed as a signer on this document.");
  if (signer.status === "signed" || signer.status === "declined") throw new Error("Cannot decline now");
  declineSigner(signer, (reason && String(reason).trim()) || "No reason given", email);
  return { ok: true };
}
