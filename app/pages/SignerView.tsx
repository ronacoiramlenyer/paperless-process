import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { pdfjsLib, type PDFDocumentProxy } from "../lib/pdfjs";
import PdfPageCanvas from "../components/PdfPageCanvas";
import SignaturePad, { type SignaturePadHandle } from "../components/SignaturePad";
import { declineSignature, fetchSignerSession, submitSignature, type SignerSessionResponse } from "../api";

const SCALE = 1.2;

export default function SignerView() {
  const { token } = useParams<{ token: string }>();
  const [session, setSession] = useState<SignerSessionResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageHeight, setPageHeight] = useState(0);

  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typedText, setTypedText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const padRef = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    if (!token) return;
    fetchSignerSession(token)
      .then(setSession)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load"));
  }, [token]);

  useEffect(() => {
    if (!token || !session?.canSign) return;
    fetch(`/api/sign/${token}/pdf`)
      .then((r) => r.arrayBuffer())
      .then((buf) => pdfjsLib.getDocument({ data: buf }).promise)
      .then(setPdfDoc);
  }, [token, session?.canSign]);

  async function refresh() {
    if (!token) return;
    const s = await fetchSignerSession(token);
    setSession(s);
  }

  async function handleSubmit() {
    if (!token || !session) return;
    setSubmitError(null);

    if (mode === "type") {
      if (!typedText.trim()) return setSubmitError("Type your name to sign.");
    } else if (padRef.current?.isEmpty()) {
      return setSubmitError("Draw your signature to sign.");
    }

    setSubmitting(true);
    try {
      await submitSignature(token, {
        signatureType: mode,
        typedText: mode === "type" ? typedText.trim() : undefined,
        imageDataUrl: mode === "draw" ? padRef.current?.toPngDataUrl() : undefined,
      });
      await refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not submit signature");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecline() {
    if (!token) return;
    const reason = window.prompt("Reason for declining (optional):") ?? "";
    setDeclining(true);
    try {
      await declineSignature(token, reason);
      await refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not decline");
    } finally {
      setDeclining(false);
    }
  }

  if (loadError) return <div className="card error-banner">{loadError}</div>;
  if (!session) return <p className="empty-state">Loading…</p>;

  const { document, signer, field, waitingOnName } = session;

  if (signer.status === "signed") {
    return (
      <div className="card">
        <h1>You're all set</h1>
        <p className="success-banner">
          You signed “{document.title}”.{" "}
          {document.status === "completed" ? "Everyone has now signed." : "Waiting on the remaining signer(s)."}
        </p>
        <a href={`/api/sign/${token}/pdf`} target="_blank" rel="noreferrer">
          <button type="button" className="secondary">
            View / download document
          </button>
        </a>
      </div>
    );
  }

  if (signer.status === "declined") {
    return (
      <div className="card">
        <h1>Declined</h1>
        <p>You declined to sign “{document.title}”.</p>
        {signer.declineReason && <p className="muted">Reason: {signer.declineReason}</p>}
      </div>
    );
  }

  if (document.status === "voided") {
    return (
      <div className="card">
        <h1>No longer available</h1>
        <p className="muted">This envelope was voided because another signer declined.</p>
      </div>
    );
  }

  if (!session.canSign) {
    return (
      <div className="card">
        <h1>{document.title}</h1>
        <p className="muted">
          This document signs in order. You'll be able to sign as soon as <strong>{waitingOnName}</strong> finishes.
        </p>
        <button className="secondary" onClick={refresh}>
          Check again
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <h1>{document.title}</h1>
        <p className="muted">
          Signing as {signer.name} ({signer.email}). Review the document below, then sign — no download needed.
        </p>
      </div>

      {pdfDoc ? (
        <div className="card">
          <h2>Document</h2>
          {Array.from({ length: pdfDoc.numPages }).map((_, pageIndex) => (
            <PdfPageCanvas
              key={pageIndex}
              doc={pdfDoc}
              pageIndex={pageIndex}
              scale={SCALE}
              onMeasured={(idx, _w, h) => {
                if (idx === field.pageIndex) setPageHeight(h);
              }}
            >
              {field.pageIndex === pageIndex && (
                <div
                  className="field-box"
                  style={{
                    left: field.x * SCALE,
                    top: pageHeight * SCALE - (field.y + field.height) * SCALE,
                    width: field.width * SCALE,
                    height: field.height * SCALE,
                  }}
                >
                  Sign here
                </div>
              )}
            </PdfPageCanvas>
          ))}
        </div>
      ) : (
        <p className="empty-state">Loading document…</p>
      )}

      <div className="card">
        <h2>Your signature</h2>
        {submitError && <div className="error-banner">{submitError}</div>}
        <div className="tabs">
          <button type="button" className={mode === "draw" ? "active" : ""} onClick={() => setMode("draw")}>
            Draw
          </button>
          <button type="button" className={mode === "type" ? "active" : ""} onClick={() => setMode("type")}>
            Type
          </button>
        </div>

        {mode === "draw" ? (
          <div>
            <SignaturePad ref={padRef} width={420} height={150} />
            <div style={{ marginTop: 8 }}>
              <button type="button" className="secondary" onClick={() => padRef.current?.clear()}>
                Clear
              </button>
            </div>
          </div>
        ) : (
          <div className="field">
            <input type="text" placeholder="Type your full name" value={typedText} onChange={(e) => setTypedText(e.target.value)} />
            {typedText && <div className="typed-signature-preview">{typedText}</div>}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Signing…" : "Sign document"}
          </button>
          <button type="button" className="danger" onClick={handleDecline} disabled={declining}>
            Decline to sign
          </button>
        </div>
      </div>
    </div>
  );
}
