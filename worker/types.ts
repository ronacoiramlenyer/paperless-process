export interface Env {
  DB: D1Database;
  DOCS: R2Bucket;
  ASSETS: Fetcher;
  APP_BASE_URL: string;
}

export type RoutingMode = "parallel" | "sequential";
export type DocumentStatus = "sent" | "completed" | "voided";
export type SignerStatus = "pending" | "viewed" | "signed" | "declined";
export type SignatureType = "draw" | "type";

export interface DocumentRow {
  id: string;
  owner_token: string;
  title: string;
  pdf_key: string;
  page_count: number;
  owner_name: string;
  owner_email: string;
  routing_mode: RoutingMode;
  status: DocumentStatus;
  created_at: string;
  completed_at: string | null;
}

export interface SignerRow {
  id: string;
  document_id: string;
  name: string;
  email: string;
  sign_token: string;
  order_index: number;
  status: SignerStatus;
  signature_type: SignatureType | null;
  typed_text: string | null;
  signature_image_key: string | null;
  signed_at: string | null;
  decline_reason: string | null;
}

export interface SignatureFieldRow {
  id: string;
  document_id: string;
  signer_id: string;
  page_index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AuditLogRow {
  id: string;
  document_id: string;
  signer_id: string | null;
  event_type: string;
  detail: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

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

export interface CreateEnvelopeInput {
  title: string;
  ownerName: string;
  ownerEmail: string;
  routingMode: RoutingMode;
  signers: SignerInput[];
}
