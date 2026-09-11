import { useRef, useState } from "react";
import { pdfjsLib, type PDFDocumentProxy } from "../lib/pdfjs";
import PdfPageCanvas from "../components/PdfPageCanvas";
import { createEnvelope, type CreateEnvelopeResponse, type RoutingMode } from "../api";

const FIELD_WIDTH_PT = 180;
const FIELD_HEIGHT_PT = 50;
const SCALE = 1.2;
const SIGNER_COLORS = ["#2f5fff", "#c93a3a", "#17845a", "#b8791a", "#7b2fc9", "#0a8f9b"];

interface DraftSigner {
  localId: string;
  name: string;
  email: string;
  field: { pageIndex: number; x: number; y: number; width: number; height: number } | null;
}

export default function CreateEnvelope() {
  const [title, setTitle] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [routingMode, setRoutingMode] = useState<RoutingMode>("parallel");
  const [signers, setSigners] = useState<DraftSigner[]>([{ localId: crypto.randomUUID(), name: "", email: "", field: null }]);
  const [armedSignerId, setArmedSignerId] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<Record<number, { width: number; height: number }>>({});

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateEnvelopeResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setPageSizes({});
    setFile(f);
    const buf = await f.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    setPdfDoc(doc);
    setSigners((prev) => prev.map((s) => ({ ...s, field: null })));
  }

  function addSigner() {
    setSigners((prev) => [...prev, { localId: crypto.randomUUID(), name: "", email: "", field: null }]);
  }

  function removeSigner(localId: string) {
    setSigners((prev) => prev.filter((s) => s.localId !== localId));
    if (armedSignerId === localId) setArmedSignerId(null);
  }

  function updateSigner(localId: string, patch: Partial<DraftSigner>) {
    setSigners((prev) => prev.map((s) => (s.localId === localId ? { ...s, ...patch } : s)));
  }

  function handlePageClick(pageIndex: number) {
    return (xPoints: number, yPoints: number) => {
      if (!armedSignerId) return;
      const size = pageSizes[pageIndex];
      const width = FIELD_WIDTH_PT;
      const height = FIELD_HEIGHT_PT;
      let x = xPoints - width / 2;
      let y = yPoints - height / 2;
      if (size) {
        x = Math.min(Math.max(0, x), Math.max(0, size.width - width));
        y = Math.min(Math.max(0, y), Math.max(0, size.height - height));
      }
      updateSigner(armedSignerId, { field: { pageIndex, x, y, width, height } });
      setArmedSignerId(null);
    };
  }

  const signerColor = (index: number) => SIGNER_COLORS[index % SIGNER_COLORS.length];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!file) return setError("Upload a PDF first.");
    if (!title.trim() || !ownerName.trim() || !ownerEmail.trim()) return setError("Fill in title and your name/email.");
    if (signers.length === 0) return setError("Add at least one signer.");
    for (const s of signers) {
      if (!s.name.trim() || !s.email.trim()) return setError("Every signer needs a name and email.");
      if (!s.field) return setError(`Place a signature field for ${s.name || "each signer"} by clicking on the document.`);
    }

    setSubmitting(true);
    try {
      const response = await createEnvelope(file, {
        title: title.trim(),
        ownerName: ownerName.trim(),
        ownerEmail: ownerEmail.trim(),
        routingMode,
        signers: signers.map((s) => ({ name: s.name.trim(), email: s.email.trim(), field: s.field! })),
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="card">
        <h1>Envelope sent</h1>
        <p className="success-banner">
          {routingMode === "parallel" ? "All signers" : "The first signer"} can open their link and sign right in the browser — no
          downloading or re-uploading.
        </p>
        <h2>Your dashboard</h2>
        <div className="link-row">
          <code>{result.ownerUrl}</code>
          <button type="button" onClick={() => navigator.clipboard.writeText(result.ownerUrl)}>
            Copy
          </button>
        </div>
        <h2 style={{ marginTop: 20 }}>Signer links</h2>
        <div className="link-list">
          {result.signerUrls.map((s) => (
            <div className="link-row" key={s.url}>
              <span style={{ minWidth: 140 }}>{s.name}</span>
              <code>{s.url}</code>
              <button type="button" onClick={() => navigator.clipboard.writeText(s.url)}>
                Copy
              </button>
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 16 }}>
          Share each link with its signer (email isn't wired up yet — copy/paste for now). Track progress from your dashboard link.
        </p>
        <button
          type="button"
          className="secondary"
          style={{ marginTop: 16 }}
          onClick={() => {
            setResult(null);
            setFile(null);
            setPdfDoc(null);
            setTitle("");
            setSigners([{ localId: crypto.randomUUID(), name: "", email: "", field: null }]);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        >
          Create another envelope
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="card">
        <h1>New envelope</h1>
        <p className="muted">Upload a PDF, add signers, click on the document to place each signature field, then send.</p>

        {error && <div className="error-banner">{error}</div>}

        <div className="field">
          <label htmlFor="title">Document title</label>
          <input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Vendor Agreement" />
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="ownerName">Your name</label>
            <input id="ownerName" type="text" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ownerEmail">Your email</label>
            <input id="ownerEmail" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="routing">Routing</label>
          <select id="routing" value={routingMode} onChange={(e) => setRoutingMode(e.target.value as RoutingMode)}>
            <option value="parallel">Parallel — everyone can sign at once</option>
            <option value="sequential">Sequential — signers sign one after another, in order</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="file">PDF document</label>
          <input id="file" ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileChange} />
        </div>
      </div>

      <div className="card">
        <h2>Signers {routingMode === "sequential" && <span className="muted">(order = signing order)</span>}</h2>
        {signers.map((s, i) => (
          <div className="signer-row" key={s.localId}>
            <span className="status-pill" style={{ background: signerColor(i), color: "white" }}>
              {i + 1}
            </span>
            <div className="field" style={{ flex: 2, marginBottom: 0 }}>
              <label>Name</label>
              <input type="text" value={s.name} onChange={(e) => updateSigner(s.localId, { name: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 2, marginBottom: 0 }}>
              <label>Email</label>
              <input type="email" value={s.email} onChange={(e) => updateSigner(s.localId, { email: e.target.value })} />
            </div>
            <button
              type="button"
              className={armedSignerId === s.localId ? "" : "secondary"}
              disabled={!pdfDoc}
              onClick={() => setArmedSignerId(armedSignerId === s.localId ? null : s.localId)}
            >
              {s.field ? (armedSignerId === s.localId ? "Click document…" : "Reposition") : armedSignerId === s.localId ? "Click document…" : "Place signature"}
            </button>
            {signers.length > 1 && (
              <button type="button" className="secondary" onClick={() => removeSigner(s.localId)}>
                Remove
              </button>
            )}
          </div>
        ))}
        <button type="button" className="secondary" onClick={addSigner}>
          + Add signer
        </button>
      </div>

      {pdfDoc && (
        <div className="card">
          <h2>Document preview</h2>
          <p className="muted">
            {armedSignerId
              ? "Click anywhere on the document to drop the signature field."
              : "Click “Place signature” above, then click the document."}
          </p>
          {Array.from({ length: pdfDoc.numPages }).map((_, pageIndex) => (
            <PdfPageCanvas
              key={pageIndex}
              doc={pdfDoc}
              pageIndex={pageIndex}
              scale={SCALE}
              onClick={armedSignerId ? handlePageClick(pageIndex) : undefined}
              onMeasured={(idx, width, height) => setPageSizes((prev) => ({ ...prev, [idx]: { width, height } }))}
            >
              {signers.map((s, i) =>
                s.field && s.field.pageIndex === pageIndex ? (
                  <div
                    key={s.localId}
                    className="field-box"
                    style={{
                      left: s.field.x * SCALE,
                      top: (pageSizes[pageIndex]?.height ?? 0) * SCALE - (s.field.y + s.field.height) * SCALE,
                      width: s.field.width * SCALE,
                      height: s.field.height * SCALE,
                      borderColor: signerColor(i),
                      background: `${signerColor(i)}22`,
                      color: signerColor(i),
                    }}
                  >
                    {s.name || `Signer ${i + 1}`}
                  </div>
                ) : null
              )}
            </PdfPageCanvas>
          ))}
        </div>
      )}

      <button type="submit" disabled={submitting}>
        {submitting ? "Sending…" : "Send for signature"}
      </button>
    </form>
  );
}
