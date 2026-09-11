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
- **Email** (optional, via [Brevo](https://brevo.com)): when configured,
  signers are emailed their sign link automatically — immediately for
  parallel routing, or as each signer's turn comes up for sequential
  routing — and the owner + all signers get a "fully signed" email once
  everyone's done. Without a Brevo API key configured, the app still works
  fully; the owner just has to share the copy-able links themselves.

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
- **[Brevo](https://brevo.com)** (optional) — sign-request and
  completion emails

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

To send real emails locally, copy `.dev.vars.example` to `.dev.vars` (already
gitignored) and fill in a [Brevo](https://brevo.com) API key (free tier, no
card required). Without it, the app runs the same but skips sending mail.

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
5. (Optional, for email) Add a `BREVO_API_KEY` secret so the Worker can send
   mail:
   - Sign up at [brevo.com](https://brevo.com) (free, no card) and create an
     API key under **Settings → SMTP & API → API Keys**.
   - Verify a sender address under **Senders, Domains & Dedicated IPs →
     Senders → Add a sender** — Brevo emails you a confirmation link, no DNS
     records needed. Set `vars.EMAIL_FROM` in `wrangler.jsonc` to that exact
     address (already defaulted to `r.canor.lasalle@gmail.com` — change it
     if you verify a different one).
   - If deploying via CLI: `npx wrangler secret put BREVO_API_KEY`
   - If deploying via Cloudflare's Git integration (Workers Builds): add it
     in the dashboard under your Worker → **Settings → Variables and
     Secrets** → add `BREVO_API_KEY` as a **Secret** (encrypted) — not a
     plaintext variable. Click **Save and deploy**.
   - Unlike some providers, Brevo's free plan lets a verified single sender
     email any recipient right away — no domain/DNS verification required
     to unblock real signers. Domain authentication is still recommended
     later for best inbox deliverability (particularly to Gmail/Yahoo).

## Known simplifications (MVP / KISS)

- No accounts/login: an envelope's owner dashboard and each signer's
  session are protected by an unguessable random token in the URL, not a
  user login. Good enough for an internal tool; add real auth if the app
  needs to enforce "only logged-in employees can create envelopes."
- Typed signatures render in an italic serif font via pdf-lib's built-in
  fonts rather than a true handwriting font (avoids bundling/embedding an
  extra font asset). Swappable in `worker/pdf.ts` if you want a fancier look.
- One signature field per signer per envelope (no free-form multi-field
  forms, initials-per-page, dates, checkboxes, etc.).
