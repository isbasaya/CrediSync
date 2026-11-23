-- Migration: dispute_evidence
-- Created: 2026-11-23
--
-- Evidence files (proof of payment, police reports) attached to disputes.
-- The file itself lives in S3 (af-south-1, KMS encrypted); this table holds
-- only metadata. Rows start 'pending' when an upload is issued, become
-- 'verified' once the object is confirmed, and 'deleting' while the object
-- is being removed. dispute_id is SET NULL on dispute deletion so the
-- object can still be found and purged. disputes.supporting_evidence is
-- dropped: the product is pre-launch, so there is nothing to migrate.
SET search_path TO credisync, public;

CREATE TYPE evidence_status AS ENUM ('pending', 'verified', 'deleting');

CREATE TABLE dispute_evidence (
    id                    UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dispute_id            UUID            REFERENCES disputes(id) ON DELETE SET NULL,
    storage_key           TEXT            NOT NULL UNIQUE,
    content_type          TEXT            NOT NULL
                          CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
    size_bytes            BIGINT          NOT NULL CHECK (size_bytes > 0),
    display_name          TEXT            NOT NULL CHECK (char_length(display_name) <= 120),
    status                evidence_status NOT NULL DEFAULT 'pending',
    created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    verified_at           TIMESTAMPTZ,
    deletion_requested_at TIMESTAMPTZ,
    -- Latest moment an issued upload link can still be used. The object is only
    -- considered gone, and the row removable, once this has passed.
    upload_url_expires_at TIMESTAMPTZ     NOT NULL
);

CREATE INDEX idx_dispute_evidence_dispute ON dispute_evidence (dispute_id);
CREATE INDEX idx_dispute_evidence_unsettled ON dispute_evidence (status, created_at)
    WHERE status <> 'verified';

ALTER TABLE disputes
    ADD COLUMN letter_has_evidence BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE disputes DROP COLUMN supporting_evidence;

-- Row-level security
ALTER TABLE dispute_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_evidence FORCE  ROW LEVEL SECURITY;

CREATE POLICY de_access ON dispute_evidence
    USING (user_id = app_user_id() OR app_is_system())
    WITH CHECK (user_id = app_user_id() OR app_is_system());

GRANT SELECT, INSERT, UPDATE, DELETE ON dispute_evidence TO credisync_app;

-- @rollback
ALTER TABLE credisync.disputes ADD COLUMN IF NOT EXISTS supporting_evidence JSONB NOT NULL DEFAULT '[]';
ALTER TABLE credisync.disputes DROP COLUMN IF EXISTS letter_has_evidence;
DROP TABLE IF EXISTS credisync.dispute_evidence;
DROP TYPE IF EXISTS credisync.evidence_status;
