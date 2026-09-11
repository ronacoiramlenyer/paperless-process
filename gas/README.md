# Paperless Process — Google Apps Script edition

Same idea as the original (upload a PDF, place signatures, route for
signing, sign in-browser, no download-sign-upload cycle) but rebuilt
entirely inside Google's ecosystem for `lsgh.edu.ph`, so no document data
or signer identity ever leaves your Workspace domain:

- **Access control is real Google identity**, not a secret link. The Web
  App requires sign-in restricted to `lsgh.edu.ph` (nobody outside your
  domain can even load the page), and every action re-checks the signed-in
  user's email against who's actually allowed (the document owner, or a
  registered signer) — not a token in the URL. A leaked link alone grants
  nothing.
- **Storage**: PDFs and drawn signature images live in a Drive folder
  ("Paperless Process Documents") owned by whoever deploys the app.
  Structured data (documents, signers, fields, audit log) lives in a
  Google Sheet ("Paperless Process — Database"), both auto-created on
  first use.
- **Home page** (`?page=home`, the default landing page): every signed-in
  user sees the documents they've sent and the documents waiting on their
  signature, each with live status, plus a "+ New envelope" link. A simple
  nav bar (Home / New envelope) appears on every page.
- **Signing options**: draw with the mouse/trackpad, type your name, or
  upload an actual photo/scan of your signature (PNG or JPEG) — uploads are
  automatically background-stripped (near-white pixels made transparent)
  client-side before sending, so a signature photographed on white paper
  doesn't paste a visible white box onto the document.
- **Email**: sent via `GmailApp` as the deploying account — no API key, no
  third-party service, no domain/sender verification. Deliverability is
  exactly as good as that account emailing by hand.
- **PDF signature stamping**: `pdf-lib`, bundled to run inside Apps
  Script's V8 runtime (see "How the PDF part works" below) — same
  approach, same visual output as the original version.

## One-time setup

### 1. Install tools locally

```bash
cd gas
npm install
npx clasp login   # opens a browser - sign in with your lsgh.edu.ph account
```

`clasp login` is interactive (real Google OAuth in a real browser) and has
to be run by a person on their own machine — there's no way to script
around that step.

### 2. Create the Apps Script project

```bash
npx clasp create --type webapp --title "Paperless Process"
```

This creates `.clasp.json` (gitignored — it holds your project's script
ID) and a bound `appsscript.json` on Google's side. Then push this
project's files:

```bash
npm run push
```

(`npm run push` runs the pdf-lib build step first, then `clasp push`.)

### 3. Deploy as a Web App

In the Apps Script editor (`npx clasp open`, or via script.google.com):

1. **Deploy → New deployment → Web app**.
2. **Execute as**: *Me* (your account — matches `appsscript.json`'s
   `executeAs: USER_DEPLOYING`, so the script always has consistent access
   to the Drive folder and Sheet regardless of who's visiting).
3. **Who has access**: *Anyone within lsgh.edu.ph* (matches
   `appsscript.json`'s `access: DOMAIN`).
4. Deploy, and copy the Web App URL it gives you
   (`https://script.google.com/macros/s/.../exec`) — that's the site.

Re-deploying after future code changes: `npm run push`, then in the editor
**Deploy → Manage deployments → edit (pencil) → New version → Deploy**
(pushing alone updates the *code*, but a live Web App URL keeps serving
the version it was deployed with until you deploy a new version).

## Test incrementally — do this before touching the UI

I built and syntax-checked all of this carefully, and independently
verified the trickiest piece (pdf-lib running inside a sandbox that mimics
Apps Script's V8 runtime — see below), but I have no way to execute real
Apps Script code myself. Two specific mechanisms are extremely likely to
work but not 100% certain until tested live in your actual environment.
Test them in this order, using the Apps Script editor's **Run** button
(Select function → Run — shows results/errors directly in the execution
log), *before* trying the full web UI:

1. **`getPdfPageCount`** — confirms the bundled pdf-lib + Drive/byte
   handling works for real. In the editor, temporarily add:
   ```js
   function testPdfCore() {
     var bytes = Utilities.base64Decode("JVBERi0xLjQK..."); // any small real PDF's base64
     Logger.log(getPdfPageCount(bytes));
   }
   ```
   Run it, check the log shows a number, not an error.
2. **`createEnvelope`** — confirms `async function`s called this way
   resolve correctly (this is the one genuinely uncertain piece — see
   "Known risk" below). Run it with a small hardcoded test payload and
   confirm it returns a real `{documentId, ownerUrl}` object in the log,
   not `undefined` or a pending Promise.

If step 2 comes back wrong, tell me exactly what you see in the log —
there's a documented fallback pattern (restructuring the entry point to
avoid relying on `google.script.run`'s handling of an async return) that I
can apply once I know which specific behavior it hits.

Once those two check out, deploy the Web App and test the actual flow:
create an envelope with yourself as a signer, sign it, check the audit
trail on the owner dashboard.

## How the PDF part works (and how I validated it without deploying)

Apps Script has no built-in equivalent of `pdf-lib`'s "draw this image/text
at this exact position" capability. `gas/src/pdf-core.js` re-implements the
same compositing logic as the original Cloudflare version, then
`build.mjs` bundles it (via esbuild) into `Pdf.generated.js` — a single
self-contained file with pdf-lib inlined, using only standard JS/Web APIs
(no Node-specific `Buffer`/`require`/`process`).

Before writing the rest of the app, I verified this actually runs correctly
by bundling it and executing it inside a Node `vm` sandbox with
`require`/`Buffer`/`process`/`module`/`__dirname` all deliberately absent
(Apps Script's V8 runtime doesn't provide any of these either) — it ran
clean and produced a valid, re-parseable PDF. There's also a real,
published Apps Script library
([tanaikech/PDFApp](https://github.com/tanaikech/PDFApp)) built the same
way, in active use, doing exactly this. `gas/verify-bundle.mjs` is that
same check, kept in the repo (`node verify-bundle.mjs`, dev-only, not
pushed to Apps Script) in case the bundling step ever needs re-validating
after a pdf-lib upgrade.

**A gap that check didn't catch**: pdf-lib periodically calls
`setTimeout(fn, 0)` internally while parsing/serializing PDFs with enough
objects (a "yield so the browser stays responsive" trick, irrelevant but
harmless in a server context) — Apps Script's server runtime has no
`setTimeout` at all, and the tiny 1-object test fixture used both in
`verify-bundle.mjs` and live testing never had enough objects to trigger
it. It only surfaced once someone tested with a real, larger PDF. Fixed by
polyfilling `setTimeout`/`clearTimeout` as synchronous no-op-wrapped calls
in `Pdf.js` (there's no event loop to protect in a single Apps Script
execution, so running immediately is correct, not just a workaround) — but
it's a reminder that `verify-bundle.mjs` only proves the bundle *can* run
in this environment, not that every code path within pdf-lib is exercised
by a trivial fixture. Worth re-testing with a real, larger PDF after any
pdf-lib version bump.

## Known simplifications / limitations

- **10MB PDF limit** (vs. 20MB in the Cloudflare version) — conservative
  headroom under `google.script.run`'s payload size limits once the file
  is base64-encoded for transfer (~33% larger than raw bytes). Can be
  raised if needed, but would likely require chunked upload.
- **No IP/user-agent in the audit trail.** Apps Script Web Apps don't
  expose the visitor's IP or User-Agent the way a normal HTTP server does.
  In exchange, every audit entry now records the actual verified Google
  identity (`actingEmail`) that performed it — arguably a stronger
  accountability signal than an IP address for an internal, authenticated
  tool.
- **Sheets-as-database** is simple and fully transparent (you can open the
  spreadsheet and read it directly), but isn't built for high concurrency
  or huge scale. Fine for a school's internal document volume; would need
  rethinking well before thousands of documents/day.
- Typed signatures render in an italic font via pdf-lib's built-in fonts,
  same as the original version.
- Still one signature field per signer per envelope — no multi-field
  forms, initials-per-page, dates, checkboxes, etc.
