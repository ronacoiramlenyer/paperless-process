-- Core schema for paperless-process: upload -> route -> sign, no download/upload cycle.

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  pdf_key TEXT NOT NULL,            -- R2 key of the pristine uploaded PDF (never mutated)
  page_count INTEGER NOT NULL,
  owner_name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  routing_mode TEXT NOT NULL CHECK (routing_mode IN ('parallel', 'sequential')),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'completed', 'voided')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

-- Final signed PDFs are composited on demand from pdf_key + each signed signer's
-- field/signature, rather than mutating a shared PDF object in place. This keeps
-- concurrent signing (parallel routing) free of read-modify-write races on R2.
CREATE TABLE signers (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  sign_token TEXT NOT NULL UNIQUE,
  order_index INTEGER NOT NULL,     -- signing order; ignored when routing_mode = 'parallel'
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'viewed', 'signed', 'declined')),
  signature_type TEXT CHECK (signature_type IN ('draw', 'type')),
  typed_text TEXT,                  -- set when signature_type = 'type'
  signature_image_key TEXT,         -- R2 key of the PNG when signature_type = 'draw'
  signed_at TEXT,
  decline_reason TEXT
);

CREATE TABLE signature_fields (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  signer_id TEXT NOT NULL REFERENCES signers(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL,      -- 0-based
  x REAL NOT NULL,                  -- PDF points from left
  y REAL NOT NULL,                  -- PDF points from bottom
  width REAL NOT NULL,
  height REAL NOT NULL
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  signer_id TEXT REFERENCES signers(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,         -- created, sent, viewed, signed, declined, completed
  detail TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_signers_document_id ON signers(document_id);
CREATE INDEX idx_signature_fields_document_id ON signature_fields(document_id);
CREATE INDEX idx_signature_fields_signer_id ON signature_fields(signer_id);
CREATE INDEX idx_audit_log_document_id ON audit_log(document_id);
