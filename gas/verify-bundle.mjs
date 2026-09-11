// One-off local verification that Pdf.generated.js works inside a
// Node-API-free sandbox (mirrors Apps Script's V8 runtime globals). Not part
// of the GAS project itself - dev-only, not pushed via clasp.
//
// Byte arrays must be constructed INSIDE the sandbox's own realm (via code
// executed through vm.runInContext), not passed in as host-created
// Uint8Array objects - vm creates a genuinely separate V8 realm, so a
// host-realm Uint8Array fails pdf-lib's internal instanceof/type checks in
// the sandbox realm. atob/btoa are injected here only as host-backed
// *functions* (safe to call across the realm boundary) purely so this test
// harness can decode its fixtures - already proven separately that pdf-lib
// itself never references atob/btoa.
import vm from "node:vm";
import fs from "node:fs";

const bundleSource = fs.readFileSync(new URL("./Pdf.generated.js", import.meta.url), "utf8");

function atob(b64) {
  return Buffer.from(b64, "base64").toString("binary");
}
function btoa(bin) {
  return Buffer.from(bin, "binary").toString("base64");
}

const sandbox = { console, atob, btoa };
sandbox.globalThis = sandbox;
const context = vm.createContext(sandbox);

const forbidden = vm.runInContext(
  `({ require: typeof require, Buffer: typeof Buffer, process: typeof process, module: typeof module, __dirname: typeof __dirname })`,
  context
);
console.log("Sandbox globals (all should be 'undefined' - proves the bundle itself needs none of these):", forbidden);
if (Object.values(forbidden).some((v) => v !== "undefined")) {
  console.error("FAIL: unexpected global present.");
  process.exit(1);
}

vm.runInContext(bundleSource, context);

context.__MINIMAL_PDF_BASE64 =
  "JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNjEyIDc5Ml0vUmVzb3VyY2VzPDw+Pi9Db250ZW50cyA0IDAgUj4+ZW5kb2JqCjQgMCBvYmo8PC9MZW5ndGggNDQ+PnN0cmVhbQpCVCAvRjEgMjQgVGYgMTAwIDcwMCBUZCAoVGVzdCBBZ3JlZW1lbnQpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDUKdHJhaWxlcjw8L1NpemUgNS9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjAKJSVFT0Y=";
context.__TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// Construct the Uint8Arrays *inside* the sandbox realm.
vm.runInContext(
  `
  function b64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  globalThis.__originalBytes = b64ToBytes(__MINIMAL_PDF_BASE64);
  globalThis.__signatureImageBytes = b64ToBytes(__TINY_PNG_BASE64);
  `,
  context
);

const pageCount = await vm.runInContext(`PdfCore.getPageCount(__originalBytes)`, context);
console.log("Page count:", pageCount);
if (pageCount !== 1) throw new Error("Expected 1 page");

vm.runInContext(
  `globalThis.__signedEntries = [
     { pageIndex: 0, x: 50, y: 50, width: 180, height: 50, signatureType: 'draw', typedText: null, signatureImageBytes: __signatureImageBytes },
     { pageIndex: 0, x: 300, y: 50, width: 180, height: 50, signatureType: 'type', typedText: 'Alice A.', signatureImageBytes: null },
   ]`,
  context
);

const outBytesInSandbox = await vm.runInContext(`PdfCore.compositeSignedPdf(__originalBytes, __signedEntries)`, context);

// Bring the result back out as a base64 string (a safe primitive to cross
// the realm boundary), then decode on the host side with real Node Buffer.
context.__outBytes = outBytesInSandbox;
const outB64 = vm.runInContext(`btoa(String.fromCharCode.apply(null, __outBytes))`, context);
const nodeBuf = Buffer.from(outB64, "base64");
fs.writeFileSync(new URL("./verify-output.pdf", import.meta.url), nodeBuf);
console.log("Composited PDF byte length:", nodeBuf.length);
console.log("Starts with %PDF:", nodeBuf.subarray(0, 5).toString("ascii"));
console.log("Contains %%EOF:", nodeBuf.toString("latin1").includes("%%EOF"));
console.log("\nPASS");
