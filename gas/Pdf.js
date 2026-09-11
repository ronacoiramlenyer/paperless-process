/**
 * Thin Apps Script wrapper around Pdf.generated.js's `PdfCore` (bundled
 * pdf-lib - see gas/src/pdf-core.js and build.mjs). Handles the Drive I/O
 * and base64<->Uint8Array conversion; PdfCore itself only ever sees
 * Uint8Array in/out and has no Apps Script dependencies at all.
 *
 * Storage model matches the original design: the uploaded PDF in Drive is
 * never mutated. Each signature (drawn PNG in Drive, or typed text) is
 * stored on its own Signer row, and the final PDF is composited on demand
 * from the original + every signed signer's field - so concurrent signers
 * (parallel routing) never race on a shared file.
 */

var DRIVE_FOLDER_NAME = "Paperless Process Documents";

function getAppFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty("DRIVE_FOLDER_ID");
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      // stale id, fall through and recreate
    }
  }
  var folder = DriveApp.createFolder(DRIVE_FOLDER_NAME);
  props.setProperty("DRIVE_FOLDER_ID", folder.getId());
  return folder;
}

function bytesToBase64_(bytes) {
  return Utilities.base64Encode(bytes);
}

function base64ToBytes_(b64) {
  // Utilities.base64Decode() returns Apps Script's own byte-array type, not
  // a real Uint8Array - pdf-lib's internal type checks reject it directly
  // (confirmed live: "pdf must be of type string or Uint8Array or
  // ArrayBuffer, but was actually of type NaN"). Wrapping it wraps the
  // *values* into a genuine same-realm Uint8Array instance.
  return new Uint8Array(Utilities.base64Decode(b64));
}

/** Saves raw bytes (from a client upload) as a Drive file in the app folder; returns the Drive file id. */
function saveBytesToDrive_(bytes, filename, mimeType) {
  var blob = Utilities.newBlob(bytes, mimeType, filename);
  var file = getAppFolder_().createFile(blob);
  return file.getId();
}

function readBytesFromDrive_(driveFileId) {
  var file = DriveApp.getFileById(driveFileId);
  return new Uint8Array(file.getBlob().getBytes());
}

function getPdfPageCount(pdfBytes) {
  return PdfCore.getPageCount(pdfBytes);
}

/**
 * Composites the pristine uploaded PDF for `documentId` with every signed
 * field, reading signature images from Drive as needed. Returns raw bytes.
 */
function compositeSignedPdfForDocument(documentId) {
  var document = getDocumentById(documentId);
  if (!document) throw new Error("Document not found: " + documentId);

  var originalBytes = readBytesFromDrive_(document.driveFileId);
  var signers = listSignersByDocumentId(documentId);
  var fields = listFieldsByDocumentId(documentId);
  var fieldBySignerId = {};
  fields.forEach(function (f) { fieldBySignerId[f.signerId] = f; });

  var signedEntries = signers
    .filter(function (s) { return s.status === "signed"; })
    .map(function (signer) {
      var field = fieldBySignerId[signer.id];
      if (!field) return null;
      var signatureImageBytes = null;
      if (signer.signatureType === "draw" && signer.signatureImageFileId) {
        signatureImageBytes = readBytesFromDrive_(signer.signatureImageFileId);
      }
      return {
        pageIndex: field.pageIndex,
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height,
        signatureType: signer.signatureType,
        typedText: signer.typedText || null,
        signatureImageBytes: signatureImageBytes,
      };
    })
    .filter(function (e) { return e !== null; });

  return PdfCore.compositeSignedPdf(originalBytes, signedEntries);
}
