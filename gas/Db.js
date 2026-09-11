/**
 * Sheet-backed data layer. Access control is NOT based on secret tokens in
 * this version - the Web App itself requires Google sign-in restricted to
 * the Workspace domain (see appsscript.json), so every caller already has a
 * verified identity (Session.getActiveUser().getEmail()). Authorization here
 * just checks that identity against the Documents/Signers rows. This is why
 * documentId can be a plain (non-secret) id in URLs: knowing it alone grants
 * nothing without also being a registered owner/signer for that document.
 */

var SHEET_NAMES = {
  DOCUMENTS: "Documents",
  SIGNERS: "Signers",
  FIELDS: "SignatureFields",
  AUDIT: "AuditLog",
};

var SHEET_HEADERS = {
  Documents: ["id", "title", "driveFileId", "pageCount", "ownerEmail", "ownerName", "routingMode", "status", "createdAt", "completedAt"],
  Signers: ["id", "documentId", "name", "email", "orderIndex", "status", "signatureType", "typedText", "signatureImageFileId", "signatureImageMimeType", "signedAt", "declineReason"],
  SignatureFields: ["id", "documentId", "signerId", "pageIndex", "x", "y", "width", "height"],
  AuditLog: ["id", "documentId", "signerId", "eventType", "detail", "actingEmail", "createdAt"],
};

function getSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("SPREADSHEET_ID");
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      // Fall through and recreate if the stored id is stale/deleted.
    }
  }
  var ss = SpreadsheetApp.create("Paperless Process — Database");
  props.setProperty("SPREADSHEET_ID", ss.getId());
  return ss;
}

function getSheet_(name) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(SHEET_HEADERS[name]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Removes Apps Script's default "Sheet1" once real sheets exist, if still present and empty. */
function cleanupDefaultSheet_() {
  var ss = getSpreadsheet_();
  var def = ss.getSheetByName("Sheet1");
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) {
    ss.deleteSheet(def);
  }
}

function newId_() {
  return Utilities.getUuid();
}

function nowIso_() {
  return new Date().toISOString();
}

/** Reads all data rows (excluding header) as an array of plain objects keyed by header name. */
function readAll_(sheetName) {
  var sheet = getSheet_(sheetName);
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = {};
    for (var c = 0; c < headers.length; c++) row[headers[c]] = values[i][c];
    rows.push(row);
  }
  return rows;
}

function appendRow_(sheetName, obj) {
  var sheet = getSheet_(sheetName);
  var headers = SHEET_HEADERS[sheetName];
  var row = headers.map(function (h) {
    var v = obj[h];
    return v === undefined || v === null ? "" : v;
  });
  sheet.appendRow(row);
}

/** Finds the 1-based sheet row index (including header) for the row whose `id` column matches. Returns -1 if not found. */
function findRowIndexById_(sheetName, id) {
  var sheet = getSheet_(sheetName);
  var idColIndex = SHEET_HEADERS[sheetName].indexOf("id") + 1;
  var values = sheet.getRange(2, idColIndex, Math.max(sheet.getLastRow() - 1, 0), 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === id) return i + 2; // +2: 1-based, plus header row
  }
  return -1;
}

function updateById_(sheetName, id, patch) {
  var rowIndex = findRowIndexById_(sheetName, id);
  if (rowIndex === -1) throw new Error("Row not found: " + sheetName + "/" + id);
  var sheet = getSheet_(sheetName);
  var headers = SHEET_HEADERS[sheetName];
  var current = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  headers.forEach(function (h, i) {
    if (Object.prototype.hasOwnProperty.call(patch, h)) current[i] = patch[h] === null ? "" : patch[h];
  });
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([current]);
}

// ---------------------------------------------------------------------------

/**
 * input: { title, ownerName, ownerEmail, routingMode, signers: [{ name, email, field: {pageIndex,x,y,width,height} }] }
 */
function createDocument(input, documentId, driveFileId, pageCount) {
  var now = nowIso_();
  var document = {
    id: documentId,
    title: input.title,
    driveFileId: driveFileId,
    pageCount: pageCount,
    ownerEmail: input.ownerEmail,
    ownerName: input.ownerName,
    routingMode: input.routingMode,
    status: "sent",
    createdAt: now,
    completedAt: "",
  };
  appendRow_(SHEET_NAMES.DOCUMENTS, document);

  var signers = input.signers.map(function (signerInput, index) {
    var signer = {
      id: newId_(),
      documentId: documentId,
      name: signerInput.name,
      email: signerInput.email,
      orderIndex: index,
      status: "pending",
      signatureType: "",
      typedText: "",
      signatureImageFileId: "",
      signatureImageMimeType: "",
      signedAt: "",
      declineReason: "",
    };
    appendRow_(SHEET_NAMES.SIGNERS, signer);

    appendRow_(SHEET_NAMES.FIELDS, {
      id: newId_(),
      documentId: documentId,
      signerId: signer.id,
      pageIndex: signerInput.field.pageIndex,
      x: signerInput.field.x,
      y: signerInput.field.y,
      width: signerInput.field.width,
      height: signerInput.field.height,
    });

    return signer;
  });

  appendRow_(SHEET_NAMES.AUDIT, {
    id: newId_(),
    documentId: documentId,
    signerId: "",
    eventType: "created",
    detail: "Envelope created with " + signers.length + " signer(s), routing=" + input.routingMode,
    actingEmail: input.ownerEmail,
    createdAt: now,
  });
  appendRow_(SHEET_NAMES.AUDIT, {
    id: newId_(),
    documentId: documentId,
    signerId: "",
    eventType: "sent",
    detail: "",
    actingEmail: input.ownerEmail,
    createdAt: now,
  });

  cleanupDefaultSheet_();

  var fields = listFieldsByDocumentId(documentId);
  return { document: document, signers: signers, fields: fields };
}

function getDocumentById(documentId) {
  var rows = readAll_(SHEET_NAMES.DOCUMENTS);
  for (var i = 0; i < rows.length; i++) if (rows[i].id === documentId) return rows[i];
  return null;
}

function listSignersByDocumentId(documentId) {
  return readAll_(SHEET_NAMES.SIGNERS)
    .filter(function (s) { return s.documentId === documentId; })
    .sort(function (a, b) { return a.orderIndex - b.orderIndex; });
}

function listFieldsByDocumentId(documentId) {
  return readAll_(SHEET_NAMES.FIELDS).filter(function (f) { return f.documentId === documentId; });
}

function listAuditLogByDocumentId(documentId) {
  return readAll_(SHEET_NAMES.AUDIT)
    .filter(function (a) { return a.documentId === documentId; })
    .sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
}

function listDocumentsByOwnerEmail(email) {
  var lower = String(email).toLowerCase();
  return readAll_(SHEET_NAMES.DOCUMENTS)
    .filter(function (d) { return String(d.ownerEmail).toLowerCase() === lower; })
    .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
}

function listSignerRowsByEmail(email) {
  var lower = String(email).toLowerCase();
  return readAll_(SHEET_NAMES.SIGNERS).filter(function (s) { return String(s.email).toLowerCase() === lower; });
}

function getFieldForSigner(signerId) {
  var rows = readAll_(SHEET_NAMES.FIELDS);
  for (var i = 0; i < rows.length; i++) if (rows[i].signerId === signerId) return rows[i];
  return null;
}

/**
 * Looks up the signer row for a document matching a specific
 * (Google-verified) email. Normally there's at most one match - but the
 * same person can legitimately be listed as more than one signer on the
 * same document (e.g. signing as both preparer and approver), so when
 * there are multiple rows for this email, prefer whichever one is still
 * actionable (not yet signed/declined) rather than always the first -
 * otherwise, once the earliest one is signed, every future visit
 * (including the email link for a *later* role) would keep resolving back
 * to that already-completed row instead of the next pending one.
 */
function getSignerForDocumentByEmail(documentId, email) {
  var rows = listSignersByDocumentId(documentId); // sorted by orderIndex
  var lower = String(email).toLowerCase();
  var matches = rows.filter(function (r) { return String(r.email).toLowerCase() === lower; });
  if (matches.length === 0) return null;
  var actionable = matches.filter(function (r) { return r.status !== "signed" && r.status !== "declined"; });
  return actionable.length > 0 ? actionable[0] : matches[matches.length - 1];
}

function appendAudit_(documentId, signerId, eventType, detail, actingEmail) {
  appendRow_(SHEET_NAMES.AUDIT, {
    id: newId_(),
    documentId: documentId,
    signerId: signerId || "",
    eventType: eventType,
    detail: detail || "",
    actingEmail: actingEmail || "",
    createdAt: nowIso_(),
  });
}

function markSignerViewed(signer, actingEmail) {
  if (signer.status !== "pending") return;
  updateById_(SHEET_NAMES.SIGNERS, signer.id, { status: "viewed" });
  appendAudit_(signer.documentId, signer.id, "viewed", "", actingEmail);
}

/**
 * params: { signatureType: 'draw'|'upload'|'type', typedText, signatureImageFileId, signatureImageMimeType }
 * Returns { allSigned, document }. Uses LockService since "is everyone done"
 * is a read-then-write sequence that must be serialized against concurrent
 * signers finishing at nearly the same time (parallel routing).
 */
function recordSignature(signer, params, actingEmail) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var now = nowIso_();
    updateById_(SHEET_NAMES.SIGNERS, signer.id, {
      status: "signed",
      signatureType: params.signatureType,
      typedText: params.typedText || "",
      signatureImageFileId: params.signatureImageFileId || "",
      signatureImageMimeType: params.signatureImageMimeType || "",
      signedAt: now,
    });
    appendAudit_(signer.documentId, signer.id, "signed", "", actingEmail);

    var allSigners = listSignersByDocumentId(signer.documentId);
    var allSigned = allSigners.every(function (s) { return s.id === signer.id || s.status === "signed"; });

    var document = getDocumentById(signer.documentId);
    if (allSigned && document.status !== "completed") {
      updateById_(SHEET_NAMES.DOCUMENTS, document.id, { status: "completed", completedAt: now });
      appendAudit_(document.id, "", "completed", "", actingEmail);
      document = getDocumentById(signer.documentId);
    }

    return { allSigned: allSigned, document: document };
  } finally {
    lock.releaseLock();
  }
}

function declineSigner(signer, reason, actingEmail) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    updateById_(SHEET_NAMES.SIGNERS, signer.id, { status: "declined", declineReason: reason });
    appendAudit_(signer.documentId, signer.id, "declined", reason, actingEmail);
    updateById_(SHEET_NAMES.DOCUMENTS, signer.documentId, { status: "voided" });
  } finally {
    lock.releaseLock();
  }
}
