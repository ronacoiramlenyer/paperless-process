/**
 * Email via GmailApp - sends as the account that deployed the Web App
 * (matches appsscript.json's executeAs: USER_DEPLOYING). No API keys, no
 * third-party service, no domain/sender verification: it's just that
 * account's real Gmail identity, so deliverability to anyone (inside or
 * outside the domain) is exactly as good as that account sending by hand.
 *
 * Every call is wrapped so a Gmail quota hit or transient error never fails
 * the document action that triggered it - same best-effort, non-blocking
 * spirit as the original Cloudflare version's email.ts.
 */

function webAppUrl_() {
  return ScriptApp.getService().getUrl();
}

function emailLayout_(heading, bodyHtml, ctaLabel, ctaUrl) {
  return (
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1c2130">' +
    "<h2 style=\"margin:0 0 12px\">" + heading + "</h2>" +
    '<div style="font-size:14px;line-height:1.5;color:#3a3f4d">' + bodyHtml + "</div>" +
    '<a href="' + ctaUrl + '" style="display:inline-block;margin-top:20px;padding:10px 18px;background:#2f5fff;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">' + ctaLabel + "</a>" +
    '<p style="margin-top:24px;font-size:12px;color:#9098a8">If the button doesn\'t work, copy this link: ' + ctaUrl + "</p>" +
    "</div>"
  );
}

function sendMail_(to, subject, html) {
  try {
    GmailApp.sendEmail(to, subject, "", { htmlBody: html, name: "Paperless Process" });
  } catch (err) {
    console.error("GmailApp send failed to " + to + ": " + err);
  }
}

function sendSignRequestEmail(document, signer) {
  var url = webAppUrl_() + "?page=sign&doc=" + encodeURIComponent(document.id);
  var html = emailLayout_(
    document.ownerName + " sent you a document to sign",
    "<p><strong>" + document.title + "</strong> is ready for your signature. Review and sign it right in your browser — no download or printing needed.</p>",
    "Review & sign",
    url
  );
  sendMail_(signer.email, "Please sign: " + document.title, html);
}

function sendCompletionEmailToOwner(document) {
  var url = webAppUrl_() + "?page=owner&doc=" + encodeURIComponent(document.id);
  var html = emailLayout_(
    "Everyone has signed",
    "<p><strong>" + document.title + "</strong> has been signed by all parties. The fully executed PDF is ready to download.</p>",
    "View & download",
    url
  );
  sendMail_(document.ownerEmail, "Fully signed: " + document.title, html);
}

function sendCompletionEmailToSigner(document, signer) {
  var url = webAppUrl_() + "?page=sign&doc=" + encodeURIComponent(document.id);
  var html = emailLayout_(
    "Document fully signed",
    "<p><strong>" + document.title + "</strong> has now been signed by everyone involved. You can view or download the final copy any time.</p>",
    "View document",
    url
  );
  sendMail_(signer.email, "Fully signed: " + document.title, html);
}
