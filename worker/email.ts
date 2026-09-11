import type { DocumentRow, Env, SignerRow } from "./types";

function layout(heading: string, bodyHtml: string, ctaLabel: string, ctaUrl: string): string {
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1c2130">
    <h2 style="margin:0 0 12px">${heading}</h2>
    <div style="font-size:14px;line-height:1.5;color:#3a3f4d">${bodyHtml}</div>
    <a href="${ctaUrl}" style="display:inline-block;margin-top:20px;padding:10px 18px;background:#2f5fff;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">${ctaLabel}</a>
    <p style="margin-top:24px;font-size:12px;color:#9098a8">If the button doesn't work, copy this link: ${ctaUrl}</p>
  </div>`;
}

/**
 * Best-effort email send via Brevo. Silently no-ops when BREVO_API_KEY
 * isn't configured, so the app works (without notifications) before an
 * owner sets one up, and a mail-provider hiccup never fails a document
 * action. Call sites should fire this via ctx.waitUntil() to avoid adding
 * latency to the response.
 */
async function sendMail(env: Env, senderName: string, to: string, subject: string, html: string): Promise<void> {
  if (!env.BREVO_API_KEY) return;
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: senderName, email: env.EMAIL_FROM },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) console.error("Brevo send failed", res.status, await res.text());
  } catch (err) {
    console.error("Brevo send threw", err);
  }
}

export async function sendSignRequestEmail(env: Env, document: DocumentRow, signer: SignerRow): Promise<void> {
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  const url = `${base}/sign/${signer.sign_token}`;
  const html = layout(
    `${document.owner_name} sent you a document to sign`,
    `<p><strong>${document.title}</strong> is ready for your signature. Review and sign it right in your browser — no download or printing needed.</p>`,
    "Review & sign",
    url
  );
  await sendMail(env, document.owner_name, signer.email, `Please sign: ${document.title}`, html);
}

export async function sendCompletionEmailToOwner(env: Env, document: DocumentRow): Promise<void> {
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  const url = `${base}/owner/${document.owner_token}`;
  const html = layout(
    "Everyone has signed",
    `<p><strong>${document.title}</strong> has been signed by all parties. The fully executed PDF is ready to download.</p>`,
    "View & download",
    url
  );
  await sendMail(env, "Paperless Process", document.owner_email, `Fully signed: ${document.title}`, html);
}

export async function sendCompletionEmailToSigner(env: Env, document: DocumentRow, signer: SignerRow): Promise<void> {
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  const url = `${base}/sign/${signer.sign_token}`;
  const html = layout(
    "Document fully signed",
    `<p><strong>${document.title}</strong> has now been signed by everyone involved. You can view or download the final copy any time.</p>`,
    "View document",
    url
  );
  await sendMail(env, "Paperless Process", signer.email, `Fully signed: ${document.title}`, html);
}
