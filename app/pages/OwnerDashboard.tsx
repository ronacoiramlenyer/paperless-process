import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchOwnerDashboard, type OwnerDashboardResponse } from "../api";

function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status}`}>{status}</span>;
}

export default function OwnerDashboard() {
  const { ownerToken } = useParams<{ ownerToken: string }>();
  const [data, setData] = useState<OwnerDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!ownerToken) return;
    try {
      const d = await fetchOwnerDashboard(ownerToken);
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load dashboard");
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerToken]);

  if (error) return <div className="card error-banner">{error}</div>;
  if (!data) return <p className="empty-state">Loading…</p>;

  const { document, signers, auditLog } = data;
  const signedCount = signers.filter((s) => s.status === "signed").length;

  return (
    <div>
      <div className="card">
        <h1>
          {document.title} <StatusPill status={document.status} />
        </h1>
        <p className="muted">
          {signedCount} of {signers.length} signed · routing: {document.routing_mode} · created{" "}
          {new Date(document.created_at).toLocaleString()}
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <a href={`/api/documents/${ownerToken}/pdf`} target="_blank" rel="noreferrer">
            <button type="button" className="secondary">
              View PDF
            </button>
          </a>
          <a href={`/api/documents/${ownerToken}/pdf?download=1`}>
            <button type="button">Download {document.status === "completed" ? "signed" : "current"} PDF</button>
          </a>
        </div>
      </div>

      <div className="card">
        <h2>Signers</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>Signed at</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            {signers.map((s) => (
              <tr key={s.id}>
                <td>{s.order_index + 1}</td>
                <td>{s.name}</td>
                <td>{s.email}</td>
                <td>
                  <StatusPill status={s.status} />
                  {s.status === "declined" && s.decline_reason && <div className="muted">{s.decline_reason}</div>}
                </td>
                <td>{s.signed_at ? new Date(s.signed_at).toLocaleString() : "—"}</td>
                <td>
                  <button type="button" className="secondary" onClick={() => navigator.clipboard.writeText(s.signUrl)}>
                    Copy link
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Audit trail</h2>
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Detail</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {auditLog.map((a) => (
              <tr key={a.id}>
                <td>{a.event_type}</td>
                <td>{a.detail ?? "—"}</td>
                <td>{new Date(a.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
