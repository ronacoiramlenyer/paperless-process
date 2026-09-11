export type RoutingMode = "parallel" | "sequential";
export type SignerStatus = "pending" | "viewed" | "signed" | "declined";

export interface FieldInput {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SignerInput {
  name: string;
  email: string;
  field: FieldInput;
}

export interface CreateEnvelopePayload {
  title: string;
  ownerName: string;
  ownerEmail: string;
  routingMode: RoutingMode;
  signers: SignerInput[];
}

export interface CreateEnvelopeResponse {
  ownerUrl: string;
  signerUrls: { name: string; email: string; url: string }[];
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

export async function createEnvelope(file: File, payload: CreateEnvelopePayload): Promise<CreateEnvelopeResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("meta", JSON.stringify(payload));
  const res = await fetch("/api/documents", { method: "POST", body: form });
  return jsonOrThrow(res);
}

export interface DocumentRow {
  id: string;
  title: string;
  page_count: number;
  owner_name: string;
  owner_email: string;
  routing_mode: RoutingMode;
  status: "sent" | "completed" | "voided";
  created_at: string;
  completed_at: string | null;
}

export interface SignerRow {
  id: string;
  name: string;
  email: string;
  order_index: number;
  status: SignerStatus;
  signed_at: string | null;
  decline_reason: string | null;
  signUrl: string;
}

export interface AuditLogRow {
  id: string;
  event_type: string;
  detail: string | null;
  created_at: string;
  signer_id: string | null;
}

export interface OwnerDashboardResponse {
  document: DocumentRow;
  signers: SignerRow[];
  auditLog: AuditLogRow[];
}

export async function fetchOwnerDashboard(ownerToken: string): Promise<OwnerDashboardResponse> {
  const res = await fetch(`/api/documents/${ownerToken}`);
  return jsonOrThrow(res);
}

export interface SignerSessionResponse {
  document: { title: string; pageCount: number; routingMode: RoutingMode; status: string };
  signer: { name: string; email: string; status: SignerStatus; declineReason: string | null };
  field: FieldInput;
  canSign: boolean;
  waitingOnName: string | null;
}

export async function fetchSignerSession(token: string): Promise<SignerSessionResponse> {
  const res = await fetch(`/api/sign/${token}`);
  return jsonOrThrow(res);
}

export async function submitSignature(
  token: string,
  body: { signatureType: "draw" | "type"; typedText?: string; imageDataUrl?: string }
): Promise<{ allSigned: boolean; documentStatus: string }> {
  const res = await fetch(`/api/sign/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(res);
}

export async function declineSignature(token: string, reason: string): Promise<void> {
  const res = await fetch(`/api/sign/${token}/decline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  await jsonOrThrow(res);
}
