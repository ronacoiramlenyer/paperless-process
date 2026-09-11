# Paperless Process

Upload a PDF, add signers, click on the document to place each signature,
send. Signers open a link and sign right in the browser — no
download-sign-upload cycle, no separate tool to re-upload to.

## How it works

- **Create an envelope** (`/`): upload a PDF, add signers, click on the
  rendered document to drop each signer's signature box, choose parallel
  (everyone signs at once) or sequential (signers sign in order) routing,
  and send. You get an owner dashboard link and one link per signer.
- **Sign** (`/sign/:token`): the signer sees the PDF rendered in-browser
  (pdf.js) with their field highlighted, draws or types their signature,
  and submits. For sequential envelopes, a signer can't sign until everyone
  ahead of them has.
- **Track** (`/owner/:ownerToken`): live status per signer, a full audit
  trail (viewed/signed/declined with timestamp, IP, user agent), and a
  download of the current (or final, once complete) signed PDF.

The uploaded PDF is never mutated in place. Each signature (drawn PNG or
typed text + field position) is stored separately, and the final PDF is
composited on demand from the original + all signed fields — so parallel
signers never race on the same file.

## Stack

- **Cloudflare Workers** ([Hono](https://hono.dev)) — API
- **Cloudflare D1** — envelopes, signers, fields, audit log
- **Cloudflare Workers KV** — original PDFs + drawn signature images
- **React + Vite**, served as static assets by the same Worker
- **pdf.js** for in-browser rendering, **pdf-lib** for server-side signature
  stamping/compositing

## Local development

```bash
npm install

# one-time: create the local D1 schema (uses Miniflare's local SQLite, no
# Cloudflare account needed)
npm run db:migrate:local

# terminal 1: the Worker API (also serves /dist once built)
npm run dev:worker

# terminal 2: the frontend with hot reload, proxying /api to the Worker
npm run dev:frontend
```

Open the Vite dev server URL. For a production-like single-process check,
run `npm run build && npm run dev:worker` and open http://localhost:8787.

## Deploying to Cloudflare

1. Create the real resources (once):
   ```bash
   npx wrangler d1 create paperless-process-db
   npx wrangler kv namespace create paperless-process-docs
   ```
   Copy the `database_id` / KV `id` from each command's output into
   `wrangler.jsonc` (`d1_databases[0].database_id` and
   `kv_namespaces[0].id`).
   (Storage uses Workers KV rather than R2 — R2 requires adding a payment
   method to your Cloudflare account even to use its free tier; KV doesn't.
   KV values cap at 25MB, comfortably above this app's 20MB PDF limit.)
2. Apply the schema to the remote database:
   ```bash
   npm run db:migrate:remote
   ```
3. Set `vars.APP_BASE_URL` in `wrangler.jsonc` to your Worker's public URL
   (needed so owner/signer links are correct).
4. Deploy:
   ```bash
   npm run deploy
   ```

## Known simplifications (MVP / KISS)

- No email sending yet — the owner shares signer links manually (copy
  buttons are provided on the confirmation screen and the dashboard).
  Wiring up an email provider only touches the `POST /api/documents`
  response in `worker/routes/documents.ts`.
- No accounts/login: an envelope's owner dashboard and each signer's
  session are protected by an unguessable random token in the URL, not a
  user login. Good enough for an internal tool; add real auth if the app
  needs to enforce "only logged-in employees can create envelopes."
- Typed signatures render in an italic serif font via pdf-lib's built-in
  fonts rather than a true handwriting font (avoids bundling/embedding an
  extra font asset). Swappable in `worker/pdf.ts` if you want a fancier look.
- One signature field per signer per envelope (no free-form multi-field
  forms, initials-per-page, dates, checkboxes, etc.).
