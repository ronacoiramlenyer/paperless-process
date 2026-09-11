/**
 * Manual smoke tests - run these from the Apps Script editor's Run button
 * (select the function name in the dropdown, then Run) while validating the
 * deployment. Committed to the repo (not just typed in the browser editor)
 * so they survive `npm run push` instead of getting wiped by it. Safe to
 * delete this whole file once you've finished validating.
 */

var TEST_MINIMAL_PDF_BASE64 =
  "JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNjEyIDc5Ml0vUmVzb3VyY2VzPDw+Pi9Db250ZW50cyA0IDAgUj4+ZW5kb2JqCjQgMCBvYmo8PC9MZW5ndGggNDQ+PnN0cmVhbQpCVCAvRjEgMjQgVGYgMTAwIDcwMCBUZCAoVGVzdCBBZ3JlZW1lbnQpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDUKdHJhaWxlcjw8L1NpemUgNS9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjAKJSVFT0Y=";

/** Step 1: confirms the pdf-lib bundle + byte handling works for real. */
async function testPdfCore() {
  var bytes = base64ToBytes_(TEST_MINIMAL_PDF_BASE64); // uses the Pdf.js helper - do not call Utilities.base64Decode() directly, see its comment
  var count = await getPdfPageCount(bytes);
  Logger.log("Page count: " + count);
}

/**
 * Step 2: confirms async server functions resolve correctly when run
 * directly (via the Run button - a different code path than
 * google.script.run, but the one thing we can validate from here).
 * Creates a REAL envelope with you as the sole signer, saves a real Drive
 * file + Sheet rows, and sends you a real "please sign" email - use your
 * own address below so you get a tangible result, and feel free to delete
 * the test rows from the "Paperless Process — Database" Sheet afterward.
 */
async function testCreateEnvelope() {
  var myEmail = Session.getActiveUser().getEmail();
  Logger.log("Running as: " + myEmail);

  var pdfBase64 = TEST_MINIMAL_PDF_BASE64;
  var meta = {
    title: "DevTests smoke test",
    ownerName: "Smoke Test",
    routingMode: "parallel",
    signers: [{ name: "Me", email: myEmail, field: { pageIndex: 0, x: 50, y: 50, width: 180, height: 50 } }],
  };

  var result = await createEnvelope(pdfBase64, meta);
  Logger.log(result); // expect a real object: { documentId: "...", ownerUrl: "https://script.google.com/.../exec?page=owner&doc=..." }
}

/** Step 3 (optional): confirms the owner dashboard read-path works, using the documentId testCreateEnvelope logged. */
function testGetOwnerDashboard(documentId) {
  Logger.log(getOwnerDashboard(documentId));
}

/**
 * Diagnostic: isolates whether the setTimeout/clearTimeout polyfill in
 * Pdf.js is actually in effect, independent of pdf-lib entirely. If this
 * itself throws ReferenceError, the polyfill isn't taking effect and the
 * fix needs a different approach; if it logs "called", the polyfill works
 * and the real ReferenceError is coming from somewhere else.
 */
function testSetTimeoutPolyfill() {
  Logger.log("typeof setTimeout: " + typeof setTimeout);
  var result = "NOT CALLED";
  setTimeout(function () { result = "CALLED"; }, 0);
  Logger.log("result: " + result);
}
