-- Migration: outbox_and_oauth
-- Created: 2026-10-25
--
-- 1. event_outbox: domain events written in the same transaction as the
--    change they describe, then relayed to SNS by the `outbox` job
--    (transactional outbox pattern — no lost or phantom events).
-- 2. oauth_link_states: short-lived PKCE/state records for the open-banking
--    consent redirect (Stitch Link).
-- 3. open_banking_links: provider account id + token expiry metadata.
SET search_path TO credisync, public;

CREATE TABLE event_outbox (
    id              BIGSERIAL   PRIMARY KEY,
    event_id        UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    event_type      TEXT        NOT NULL,           -- e.g. 'dispute.submitted'
    aggregate_type  TEXT        NOT NULL,           -- e.g. 'dispute'
    aggregate_id    UUID,
    user_id         UUID,                           -- pseudonymous; no FK so erasure never blocks
    payload         JSONB       NOT NULL DEFAULT '{}',  -- ids and codes only, never personal information
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at    TIMESTAMPTZ,
    attempts        SMALLINT    NOT NULL DEFAULT 0,
    last_error      TEXT,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outbox_pending ON event_outbox (next_attempt_at, id) WHERE published_at IS NULL;

CREATE TABLE oauth_link_states (
    state_hash      TEXT        PRIMARY KEY,        -- SHA-256 of the state sent to the provider
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider        ingestion_source NOT NULL,
    code_verifier_encrypted BYTEA NOT NULL,         -- PKCE verifier, AES-256-GCM envelope
    nonce           TEXT        NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ols_user ON oauth_link_states (user_id);

ALTER TABLE open_banking_links
    ADD COLUMN provider_account_id TEXT,
    ADD COLUMN token_expires_at    TIMESTAMPTZ,
    ADD COLUMN last_refreshed_at   TIMESTAMPTZ;

-- Row-level security
ALTER TABLE event_outbox      ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_outbox      FORCE  ROW LEVEL SECURITY;
ALTER TABLE oauth_link_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_link_states FORCE  ROW LEVEL SECURITY;

-- Any request may append an event; only the relay (system context) reads or updates them.
CREATE POLICY outbox_insert ON event_outbox FOR INSERT WITH CHECK (TRUE);
CREATE POLICY outbox_system ON event_outbox FOR SELECT USING (app_is_system());
CREATE POLICY outbox_update ON event_outbox FOR UPDATE USING (app_is_system()) WITH CHECK (app_is_system());
CREATE POLICY outbox_delete ON event_outbox FOR DELETE USING (app_is_system());

CREATE POLICY ols_access ON oauth_link_states
    USING (user_id = app_user_id() OR app_is_system())
    WITH CHECK (user_id = app_user_id() OR app_is_system());

GRANT SELECT, INSERT, UPDATE, DELETE ON event_outbox, oauth_link_states TO credisync_app;
GRANT USAGE, SELECT ON SEQUENCE event_outbox_id_seq TO credisync_app;

-- @rollback
DROP TABLE IF EXISTS credisync.oauth_link_states;
DROP TABLE IF EXISTS credisync.event_outbox;
ALTER TABLE credisync.open_banking_links
    DROP COLUMN IF EXISTS provider_account_id,
    DROP COLUMN IF EXISTS token_expires_at,
    DROP COLUMN IF EXISTS last_refreshed_at;
