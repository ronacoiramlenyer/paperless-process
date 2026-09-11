/**
 * Web App entry point. Routes ?page=home|create|owner|sign to the matching
 * HtmlService template (home is the default when no page is given). Google
 * sign-in (restricted to the Workspace domain via appsscript.json) has
 * already happened before this ever runs.
 */
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || "home";
  var docId = (e && e.parameter && e.parameter.doc) || "";

  var templateName =
    page === "create" ? "Views/CreateEnvelope" :
    page === "owner" ? "Views/OwnerDashboard" :
    page === "sign" ? "Views/SignerView" :
    "Views/Home";

  var template = HtmlService.createTemplateFromFile(templateName);
  template.documentId = docId;
  template.userEmail = Session.getActiveUser().getEmail();

  return template
    .evaluate()
    .setTitle("Paperless Process")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Used by templates as `<?!= include('Views/Shared') ?>` to inline shared CSS/JS. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
