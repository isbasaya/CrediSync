-- =============================================================================
-- CrediSync Core Database Schema
-- PostgreSQL 15+  |  AWS Africa (Cape Town) af-south-1
--
-- Regulatory alignment:
--   • Protection of Personal Information Act (POPIA) – data minimisation,
--     consent tracking (with policy version), purpose limitation,
--     data-subject access logs, right to erasure (s24).
--   • National Credit Act (NCA) – credit bureau data retention limits,
--     dispute workflow records and statutory response deadlines.
--
-- Security:
--   • SA ID numbers are encrypted in the application layer with AES-256-GCM
--     envelope encryption (data key wrapped by AWS KMS) and stored as the
--     serialised envelope in users.sa_id_encrypted. A keyed HMAC-SHA256 of
--     the ID (users.sa_id_hash) supports uniqueness/lookup without decryption.
--   • Row-level security (RLS) is ENABLED and FORCED on every table that
--     holds personal information. Services connect as a member of the
--     non-owner role `credisync_app`, so policies always apply. Each request
--     sets either `app.current_user_id` (acting for one consumer) or
--     `app.system_context = 'on'` (explicit, audited cross-user work such as
--     admin views, login lookup and scheduled jobs).
--   • All timestamps are stored in UTC.
--
-- Status enum values in this schema are the single source of truth and map
-- 1-to-1 to the design tokens in design-system/tokens.ts:
--   score_band      → ScoreBand type (excellent | good | fair | poor | very_poor)
--   account_status  → AccountStatus type
--
-- packages/migrations/migrations/20240101000000_initial_schema.sql must stay
-- byte-identical to this file (enforced by a test in packages/migrations).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- fuzzy search for entity resolution
CREATE EXTENSION IF NOT EXISTS "btree_gin";  -- composite GIN indexes

-- ---------------------------------------------------------------------------
-- Application role
--
-- NOLOGIN group role that owns no tables. Login users for each service are
-- created per environment (see db/dev/00-roles.sql for local development)
-- and granted membership of this role.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    CREATE ROLE credisync_app NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Schema namespace
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS credisync;
SET search_path TO credisync, public;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Credit score bands (maps directly to design token ScoreBand)
CREATE TYPE score_band AS ENUM (
    'excellent',   -- 767–999  → green
    'good',        -- 681–766  → green
    'fair',        -- 614–680  → amber
    'poor',        -- 583–613  → amber
    'very_poor'    -- 0–582    → red
);

-- Credit bureau account status (maps to AccountStatus design token)
CREATE TYPE account_status AS ENUM (
    'current',      -- green
    'arrears',      -- amber
    'default',      -- red
    'judgement',    -- red
    'written_off',  -- slate (neutral)
    'unknown'       -- slate; bureau sent a status we have not mapped yet
);

-- Credit bureaus supported
CREATE TYPE bureau_source AS ENUM (
    'transunion',
    'experian',
    'xds'
);

-- Dispute lifecycle states
CREATE TYPE dispute_status AS ENUM (
    'draft',
    'submitted',
    'under_review',
    'resolved_upheld',    -- dispute upheld; bureau corrected record
    'resolved_rejected',  -- bureau rejected dispute
    'escalated_ncr'       -- escalated to National Credit Regulator
);

-- Grounds of dispute (drives the letter template clause)
CREATE TYPE dispute_reason AS ENUM (
    'not_my_account',
    'incorrect_balance',
    'incorrect_status',
    'paid_but_reflecting_outstanding',
    'duplicate_listing',
    'identity_theft_fraud',
    'settled_in_full_not_updated',
    'prescribed_debt',
    'incorrect_personal_details'
);

-- Open banking transaction categories
CREATE TYPE transaction_category AS ENUM (
    'income',
    'housing',
    'transport',
    'food_groceries',
    'utilities',
    'insurance',
    'debt_repayment',
    'savings',
    'entertainment',
    'healthcare',
    'education',
    'gambling',
    'transfers',
    'other'
);

CREATE TYPE ingestion_source AS ENUM ('stitch', 'ozow');

CREATE TYPE bank_readiness_tier AS ENUM ('prime', 'near_prime', 'sub_prime', 'unqualified');

CREATE TYPE user_role AS ENUM ('consumer', 'admin', 'compliance_officer');

-- Regulatory audit event types (mirrored by AuditEventType in packages/types)
CREATE TYPE audit_event_type AS ENUM (
    'user_registered',
    'user_login',
    'user_login_failed',
    'user_logout',
    'account_locked',
    'email_verified',
    'consent_granted',
    'consent_revoked',
    'data_access',          -- subject accessed their own data
    'data_export',          -- POPIA Section 23 data-subject access request
    'data_deletion_request',
    'data_deletion_completed',
    'bureau_pull',
    'bank_link_created',
    'bank_data_ingested',
    'dispute_created',
    'dispute_submitted',
    'dispute_bureau_response',
    'dispute_resolved',
    'dispute_escalated',
    'dispute_deadline_breached',
    'score_computed',
    'bank_readiness_scored',
    'ai_entity_merge',
    'admin_access'
);

-- ---------------------------------------------------------------------------
-- RLS helper functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_user_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_user_id', TRUE), '')::UUID
$$;

CREATE OR REPLACE FUNCTION app_is_system()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('app.system_context', TRUE), '') = 'on'
$$;

-- ---------------------------------------------------------------------------
-- Table: users
--
-- Core user profile.  SA ID stored encrypted; never stored in plaintext.
-- All POPIA consent flags are explicit boolean columns so queries remain
-- efficient; popia_consent_audit records every change.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Contact (email always stored lower-cased)
    email                   TEXT        NOT NULL UNIQUE,
    mobile_number           TEXT        NOT NULL,           -- E.164 format e.g. +27821234567
    first_name              TEXT        NOT NULL,
    last_name               TEXT        NOT NULL,

    -- SA ID: serialised AES-256-GCM envelope (see packages/crypto).
    -- Application layer must decrypt before use; never log in plaintext.
    sa_id_encrypted         BYTEA       NOT NULL,
    sa_id_hash              TEXT        NOT NULL UNIQUE,    -- keyed HMAC-SHA256 for lookup only

    -- POPIA consent flags (Section 11 – lawful processing basis)
    popia_consent_granted   BOOLEAN     NOT NULL DEFAULT FALSE,
    popia_consent_date      TIMESTAMPTZ,
    popia_policy_version    TEXT,                           -- privacy notice version accepted
    credit_check_consent    BOOLEAN     NOT NULL DEFAULT FALSE,  -- permission to pull bureau reports
    marketing_consent       BOOLEAN     NOT NULL DEFAULT FALSE,
    third_party_sharing     BOOLEAN     NOT NULL DEFAULT FALSE,
    open_banking_consent    BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Authentication / authorisation
    role                    user_role   NOT NULL DEFAULT 'consumer',
    auth_provider           TEXT        NOT NULL DEFAULT 'email', -- email | google | apple
    is_verified             BOOLEAN     NOT NULL DEFAULT FALSE,
    email_verified_at       TIMESTAMPTZ,
    is_active               BOOLEAN     NOT NULL DEFAULT TRUE,
    failed_login_attempts   SMALLINT    NOT NULL DEFAULT 0,
    locked_until            TIMESTAMPTZ,

    -- Metadata
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at           TIMESTAMPTZ,

    CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
    CONSTRAINT users_mobile_format CHECK (mobile_number ~ '^\+27[0-9]{9}$'),
    CONSTRAINT users_consent_date  CHECK (
        (popia_consent_granted = TRUE AND popia_consent_date IS NOT NULL AND popia_policy_version IS NOT NULL)
        OR popia_consent_granted = FALSE
    )
);

CREATE INDEX idx_users_created_at    ON users (created_at);

-- ---------------------------------------------------------------------------
-- Table: user_passwords
--
-- Stores bcrypt password hashes separately from the users table so the
-- password column can never leak via a SELECT * on users. One row per user.
-- ---------------------------------------------------------------------------
CREATE TABLE user_passwords (
    user_id         UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash   TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Table: user_sessions
--
-- Refresh-token sessions. Only a SHA-256 of the opaque refresh token is
-- stored. Tokens rotate on every use; reuse of a rotated token revokes the
-- whole session family.
-- ---------------------------------------------------------------------------
CREATE TABLE user_sessions (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id           UUID        NOT NULL,
    refresh_token_hash  TEXT        NOT NULL UNIQUE,
    user_agent          TEXT,
    ip_address          INET,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,
    rotated_at          TIMESTAMPTZ,
    revoked_at          TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user   ON user_sessions (user_id);
CREATE INDEX idx_sessions_family ON user_sessions (family_id);

-- ---------------------------------------------------------------------------
-- Table: email_verification_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE email_verification_tokens (
    token_hash      TEXT        PRIMARY KEY,
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_evt_user ON email_verification_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Table: credit_profiles
--
-- Unified multi-bureau credit profile for a user after entity resolution.
-- One current row per user (enforced); history preserved via versioning.
-- ---------------------------------------------------------------------------
CREATE TABLE credit_profiles (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Unified / resolved scores (post entity-resolution merge, normalised scale)
    unified_score           SMALLINT,                        -- 0–999
    unified_score_band      score_band,
    entity_resolution_ver   SMALLINT    NOT NULL DEFAULT 1,  -- matcher version

    -- Per-bureau scores as reported by each bureau (nullable if not fetched)
    transunion_score        SMALLINT,
    transunion_score_band   score_band,
    transunion_fetched_at   TIMESTAMPTZ,

    experian_score          SMALLINT,
    experian_score_band     score_band,
    experian_fetched_at     TIMESTAMPTZ,

    xds_score               SMALLINT,
    xds_score_band          score_band,
    xds_fetched_at          TIMESTAMPTZ,

    -- Aggregate derogatory info
    total_accounts          SMALLINT    NOT NULL DEFAULT 0,
    open_accounts           SMALLINT    NOT NULL DEFAULT 0,
    adverse_accounts        SMALLINT    NOT NULL DEFAULT 0,
    judgements_count        SMALLINT    NOT NULL DEFAULT 0,
    defaults_count          SMALLINT    NOT NULL DEFAULT 0,
    enquiries_last_12m      SMALLINT    NOT NULL DEFAULT 0,

    -- NCA-mandated data
    total_credit_exposure   NUMERIC(14,2) NOT NULL DEFAULT 0,  -- ZAR
    monthly_instalment      NUMERIC(14,2) NOT NULL DEFAULT 0,  -- ZAR

    -- Bank-readiness score (rules model output, 0–100)
    bank_readiness_score    NUMERIC(5,2),
    bank_readiness_tier     bank_readiness_tier,
    bank_readiness_model    TEXT,
    bank_readiness_scored_at TIMESTAMPTZ,

    is_current              BOOLEAN     NOT NULL DEFAULT TRUE,  -- FALSE once superseded
    profile_version         SMALLINT    NOT NULL DEFAULT 1,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT cp_transunion_range  CHECK (transunion_score BETWEEN 0 AND 999),
    CONSTRAINT cp_experian_range    CHECK (experian_score   BETWEEN 0 AND 999),
    CONSTRAINT cp_xds_range         CHECK (xds_score        BETWEEN 0 AND 999),
    CONSTRAINT cp_unified_range     CHECK (unified_score    BETWEEN 0 AND 999),
    CONSTRAINT cp_readiness_range   CHECK (bank_readiness_score BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX uq_cp_one_current_per_user ON credit_profiles (user_id) WHERE is_current = TRUE;
CREATE INDEX idx_cp_user_created  ON credit_profiles (user_id, created_at DESC);
CREATE INDEX idx_cp_unified_score ON credit_profiles (unified_score) WHERE is_current = TRUE;

-- ---------------------------------------------------------------------------
-- Table: bureau_accounts
--
-- Individual credit accounts exactly as reported by each bureau (one row per
-- account per bureau, values NOT overwritten by the merge so disputes can
-- quote the bureau's own figures). Rows sharing resolved_account_id are the
-- same real-world facility; is_cluster_primary marks the row shown in lists.
-- ---------------------------------------------------------------------------
CREATE TABLE bureau_accounts (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    credit_profile_id       UUID        NOT NULL REFERENCES credit_profiles(id) ON DELETE CASCADE,
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    bureau                  bureau_source NOT NULL,
    account_reference       TEXT        NOT NULL,   -- obfuscated by bureau
    creditor_name           TEXT        NOT NULL,
    account_type            TEXT        NOT NULL,   -- e.g. 'home_loan', 'credit_card', 'clothing'
    status                  account_status NOT NULL,
    raw_status              TEXT,                   -- bureau's own status string, for audit
    opened_date             DATE,
    closed_date             DATE,
    credit_limit            NUMERIC(14,2),
    current_balance         NUMERIC(14,2) NOT NULL DEFAULT 0,
    overdue_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
    instalment_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
    months_in_arrears       SMALLINT    NOT NULL DEFAULT 0,
    worst_status_12m        account_status,
    payment_profile         CHAR(24),               -- 24-month rolling payment string

    -- Entity resolution: cluster id shared by rows for the same facility
    resolved_account_id     UUID        NOT NULL,
    is_cluster_primary      BOOLEAN     NOT NULL DEFAULT FALSE,
    resolution_confidence   NUMERIC(4,3),           -- 0.000–1.000

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (credit_profile_id, bureau, account_reference)
);

CREATE INDEX idx_ba_profile      ON bureau_accounts (credit_profile_id);
CREATE INDEX idx_ba_user         ON bureau_accounts (user_id);
CREATE INDEX idx_ba_status       ON bureau_accounts (status);
CREATE INDEX idx_ba_resolved     ON bureau_accounts (resolved_account_id);

-- ---------------------------------------------------------------------------
-- Table: open_banking_links
--
-- Account-scoped access tokens issued by Stitch/Ozow after the consumer's
-- consent flow. Stored encrypted (AES-256-GCM envelope); never returned to
-- clients. Revoked links are kept (without token) for the audit trail.
-- ---------------------------------------------------------------------------
CREATE TABLE open_banking_links (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source              ingestion_source NOT NULL,
    token_encrypted     BYTEA,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at          TIMESTAMPTZ
);

CREATE INDEX idx_obl_user ON open_banking_links (user_id);

-- ---------------------------------------------------------------------------
-- Table: financial_health_snapshots
--
-- Aggregated open-banking / transaction data ingested via Stitch or Ozow.
-- Monetary figures are MONTHLY averages over the snapshot period.
-- ---------------------------------------------------------------------------
CREATE TABLE financial_health_snapshots (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Snapshot period
    period_start            DATE        NOT NULL,
    period_end              DATE        NOT NULL,
    period_months           NUMERIC(5,2) NOT NULL DEFAULT 1,
    ingestion_source        ingestion_source NOT NULL,

    -- Income metrics (monthly)
    gross_income            NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_income              NUMERIC(14,2) NOT NULL DEFAULT 0,
    income_streams          SMALLINT    NOT NULL DEFAULT 0,
    income_regularity_score NUMERIC(4,3),   -- 0–1: how consistent income is
    unclassified_credits    NUMERIC(14,2) NOT NULL DEFAULT 0,  -- credits NOT counted as income

    -- Expense categories (monthly ZAR)
    housing_expenses        NUMERIC(14,2) NOT NULL DEFAULT 0,
    transport_expenses      NUMERIC(14,2) NOT NULL DEFAULT 0,
    food_expenses           NUMERIC(14,2) NOT NULL DEFAULT 0,
    utilities_expenses      NUMERIC(14,2) NOT NULL DEFAULT 0,
    insurance_expenses      NUMERIC(14,2) NOT NULL DEFAULT 0,
    debt_repayment_total    NUMERIC(14,2) NOT NULL DEFAULT 0,
    entertainment_expenses  NUMERIC(14,2) NOT NULL DEFAULT 0,
    gambling_spend          NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- Ratios
    debt_to_income_ratio    NUMERIC(5,4),   -- e.g. 0.3500
    savings_rate            NUMERIC(5,4),

    -- Liquidity
    average_closing_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
    lowest_balance_30d      NUMERIC(14,2),
    overdraft_days_30d      SMALLINT    NOT NULL DEFAULT 0,
    returned_debit_count    SMALLINT    NOT NULL DEFAULT 0,

    -- Bank-readiness inputs (monthly)
    minimum_expense_norm    NUMERIC(14,2),  -- NCA affordability regulations norm
    affordability_surplus   NUMERIC(14,2),  -- net income − max(observed expenses, norm) − debt
    nca_nett_income         NUMERIC(14,2),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fhs_period_order CHECK (period_end >= period_start)
);

CREATE INDEX idx_fhs_user_period ON financial_health_snapshots (user_id, period_end DESC);

-- ---------------------------------------------------------------------------
-- Table: transactions
--
-- Individual bank transactions ingested via open banking.
-- Partitioned by year. A DEFAULT partition guarantees inserts never fail;
-- the scheduled `partitions` job calls ensure_transactions_partition() so
-- each year gets its own partition before it starts.
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
    id                      UUID        NOT NULL DEFAULT gen_random_uuid(),
    snapshot_id             UUID        NOT NULL REFERENCES financial_health_snapshots(id) ON DELETE CASCADE,
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    provider_transaction_id TEXT,                    -- provider id, for de-duplication
    transaction_date        DATE        NOT NULL,
    posted_date             DATE,
    amount                  NUMERIC(14,2) NOT NULL,  -- negative = debit
    currency                CHAR(3)     NOT NULL DEFAULT 'ZAR',
    description             TEXT        NOT NULL,
    category                transaction_category NOT NULL DEFAULT 'other',
    is_recurring            BOOLEAN     NOT NULL DEFAULT FALSE,
    merchant_name           TEXT,
    reference               TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, transaction_date)
) PARTITION BY RANGE (transaction_date);

CREATE OR REPLACE FUNCTION ensure_transactions_partition(p_year INT)
RETURNS TEXT LANGUAGE plpgsql
SECURITY DEFINER SET search_path = credisync, public AS $$
DECLARE
    part_name TEXT := format('transactions_%s', p_year);
BEGIN
    IF to_regclass(format('credisync.%I', part_name)) IS NULL THEN
        EXECUTE format(
            'CREATE TABLE credisync.%I PARTITION OF credisync.transactions FOR VALUES FROM (%L) TO (%L)',
            part_name, make_date(p_year, 1, 1), make_date(p_year + 1, 1, 1)
        );
    END IF;
    RETURN part_name;
END;
$$;

SELECT ensure_transactions_partition(y) FROM generate_series(2024, 2028) AS y;
CREATE TABLE transactions_default PARTITION OF transactions DEFAULT;

CREATE INDEX idx_tx_user_date   ON transactions (user_id, transaction_date DESC);
CREATE INDEX idx_tx_category    ON transactions (user_id, category);
CREATE INDEX idx_tx_snapshot    ON transactions (snapshot_id);
CREATE INDEX idx_tx_provider_id ON transactions (user_id, provider_transaction_id);

-- ---------------------------------------------------------------------------
-- Table: disputes
--
-- Legal dispute records for NCA/NCR-compliant bureau dispute submissions.
-- Each row tracks one dispute through its full lifecycle.
-- ---------------------------------------------------------------------------
CREATE TABLE disputes (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- NO ACTION (checked at end of statement) so deleting a user cascades
    -- through disputes and bureau_accounts in one statement, while still
    -- preventing a profile clean-up from orphaning an active dispute.
    bureau_account_id       UUID        NOT NULL REFERENCES bureau_accounts(id),

    bureau                  bureau_source NOT NULL,
    dispute_reason          dispute_reason NOT NULL,
    dispute_description     TEXT        NOT NULL,
    supporting_evidence     JSONB       NOT NULL DEFAULT '[]',  -- array of storage object keys
    status                  dispute_status NOT NULL DEFAULT 'draft',

    -- Generated letter content
    letter_content          TEXT,
    letter_generated_at     TIMESTAMPTZ,
    letter_version          SMALLINT    NOT NULL DEFAULT 0,

    -- Submission tracking
    submitted_at            TIMESTAMPTZ,
    submission_channel      TEXT,   -- 'manual' (ops team) | 'bureau_api'
    bureau_reference        TEXT,   -- reference number returned by bureau
    bureau_response         TEXT,
    bureau_responded_at     TIMESTAMPTZ,
    resolved_at             TIMESTAMPTZ,

    -- NCR / ombud escalation
    ncr_case_number         TEXT,
    ncr_escalated_at        TIMESTAMPTZ,

    -- Statutory 20 business-day response window (NCA s72 and regulations)
    resolution_deadline     DATE,
    deadline_breached_at    TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT dispute_ncr_requires_submission CHECK (
        ncr_escalated_at IS NULL OR submitted_at IS NOT NULL
    )
);

CREATE INDEX idx_disputes_user     ON disputes (user_id, created_at DESC);
CREATE INDEX idx_disputes_status   ON disputes (status);
CREATE INDEX idx_disputes_deadline ON disputes (resolution_deadline)
    WHERE status IN ('submitted', 'under_review') AND deadline_breached_at IS NULL;

-- Idempotency for signed bureau webhooks
CREATE TABLE dispute_webhook_events (
    event_id        TEXT        PRIMARY KEY,
    dispute_id      UUID        NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One-off public holidays declared under the Public Holidays Act s2A
-- (e.g. election days) that the computed calendar cannot know about.
CREATE TABLE public_holiday_overrides (
    holiday_date    DATE        PRIMARY KEY,
    name            TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Table: data_deletion_requests (POPIA s24 erasure)
-- ---------------------------------------------------------------------------
CREATE TABLE data_deletion_requests (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL,   -- no FK: survives the deletion it records
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scheduled_for   TIMESTAMPTZ NOT NULL,   -- grace period to cancel
    cancelled_at    TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_ddr_pending ON data_deletion_requests (scheduled_for)
    WHERE completed_at IS NULL AND cancelled_at IS NULL;

-- ---------------------------------------------------------------------------
-- Table: regulatory_audit_logs
--
-- Immutable append-only log of all data-access and processing events.
-- Required by POPIA Section 22 (notification) and Section 23 (access log).
-- user_id is deliberately NOT a foreign key: when a user is erased the log
-- keeps a pseudonymous UUID that no longer links to any person, and the
-- append-only trigger is never tripped by an FK "SET NULL" update.
-- Retention: 5 years minimum; only the retention job may purge older rows.
-- ---------------------------------------------------------------------------
CREATE TABLE regulatory_audit_logs (
    id              BIGSERIAL   PRIMARY KEY,
    user_id         UUID,
    event_type      audit_event_type NOT NULL,
    performed_by    UUID,       -- UUID of user or service-account performing action
    ip_address      INET,
    user_agent      TEXT,
    resource_type   TEXT,       -- e.g. 'credit_profile', 'dispute'
    resource_id     UUID,
    payload         JSONB       NOT NULL DEFAULT '{}',  -- sanitised; no PII in payload
    success         BOOLEAN     NOT NULL DEFAULT TRUE,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only: UPDATE is never allowed. DELETE only for rows past the
-- 5-year retention floor, and only when the retention job opts in.
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND COALESCE(current_setting('app.audit_retention_purge', TRUE), '') = 'on'
       AND OLD.created_at < NOW() - INTERVAL '5 years' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'regulatory_audit_logs is append-only; UPDATE and DELETE are not permitted.';
END;
$$;

CREATE TRIGGER trg_audit_no_update
    BEFORE UPDATE ON regulatory_audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

CREATE TRIGGER trg_audit_no_delete
    BEFORE DELETE ON regulatory_audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

CREATE INDEX idx_ral_user_event  ON regulatory_audit_logs (user_id, event_type, created_at DESC);
CREATE INDEX idx_ral_created_at  ON regulatory_audit_logs (created_at DESC);
CREATE INDEX idx_ral_resource    ON regulatory_audit_logs (resource_type, resource_id) WHERE resource_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Table: popia_consent_audit
--
-- Granular consent change history (POPIA Section 11 requirement), kept as
-- proof of consent. Like the audit log, user_id is not a foreign key.
-- ---------------------------------------------------------------------------
CREATE TABLE popia_consent_audit (
    id              BIGSERIAL   PRIMARY KEY,
    user_id         UUID        NOT NULL,
    consent_type    TEXT        NOT NULL,   -- 'popia' | 'credit_check' | 'marketing' | 'third_party' | 'open_banking'
    previous_value  BOOLEAN,
    new_value       BOOLEAN     NOT NULL,
    policy_version  TEXT,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pca_user ON popia_consent_audit (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Updated-at trigger (shared)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_up_updated_at
    BEFORE UPDATE ON user_passwords
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_cp_updated_at
    BEFORE UPDATE ON credit_profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_ba_updated_at
    BEFORE UPDATE ON bureau_accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_disputes_updated_at
    BEFORE UPDATE ON disputes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- ENABLE + FORCE on every personal-information table. "Owner" policies let
-- a request acting for one consumer see only that consumer's rows; system
-- context is an explicit opt-in used for admin, login and job work.
-- ---------------------------------------------------------------------------
ALTER TABLE users                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                      FORCE  ROW LEVEL SECURITY;
ALTER TABLE user_passwords             ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_passwords             FORCE  ROW LEVEL SECURITY;
ALTER TABLE user_sessions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions              FORCE  ROW LEVEL SECURITY;
ALTER TABLE email_verification_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_verification_tokens  FORCE  ROW LEVEL SECURITY;
ALTER TABLE credit_profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_profiles            FORCE  ROW LEVEL SECURITY;
ALTER TABLE bureau_accounts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bureau_accounts            FORCE  ROW LEVEL SECURITY;
ALTER TABLE open_banking_links         ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_banking_links         FORCE  ROW LEVEL SECURITY;
ALTER TABLE financial_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_health_snapshots FORCE  ROW LEVEL SECURITY;
ALTER TABLE transactions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions               FORCE  ROW LEVEL SECURITY;
ALTER TABLE disputes                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes                   FORCE  ROW LEVEL SECURITY;
ALTER TABLE dispute_webhook_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_webhook_events     FORCE  ROW LEVEL SECURITY;
ALTER TABLE data_deletion_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_deletion_requests     FORCE  ROW LEVEL SECURITY;
ALTER TABLE regulatory_audit_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_audit_logs      FORCE  ROW LEVEL SECURITY;
ALTER TABLE popia_consent_audit        ENABLE ROW LEVEL SECURITY;
ALTER TABLE popia_consent_audit        FORCE  ROW LEVEL SECURITY;

CREATE POLICY users_access ON users
    USING (id = app_user_id() OR app_is_system())
    WITH CHECK (id = app_user_id() OR app_is_system());

-- Credentials and tokens: identity service (system context) only
CREATE POLICY up_system   ON user_passwords            USING (app_is_system()) WITH CHECK (app_is_system());
CREATE POLICY us_system   ON user_sessions             USING (app_is_system()) WITH CHECK (app_is_system());
CREATE POLICY evt_system  ON email_verification_tokens USING (app_is_system()) WITH CHECK (app_is_system());
CREATE POLICY dwe_system  ON dispute_webhook_events    USING (app_is_system()) WITH CHECK (app_is_system());

CREATE POLICY cp_access ON credit_profiles
    USING (user_id = app_user_id() OR app_is_system())
    WITH CHECK (user_id = app_user_id() OR app_is_system());
CREATE POLICY ba_access ON bureau_accounts
    USING (user_id = app_user_id() OR app_is_system())
    WITH CHECK (user_id = app_user_id() OR app_is_system());
CREATE POLICY obl_access ON open_banking_links
    USING (user_id = app_user_id() OR app_is_system())
    WITH CHECK (user_id = app_user_id() OR app_is_system());
CREATE POLICY fhs_access ON financial_health_snapshots
    USING (user_id = app_user_id() OR app_is_system())
    WITH CHECK (user_id = app_user_id() OR app_is_system());
CREATE POLICY tx_access ON transactions
    USING (user_id = app_user_id() OR app_is_system())
    WITH CHECK (user_id = app_user_id() OR app_is_system());
CREATE POLICY disputes_access ON disputes
    USING (user_id = app_user_id() OR app_is_system())
    WITH CHECK (user_id = app_user_id() OR app_is_system());
CREATE POLICY ddr_access ON data_deletion_requests
    USING (user_id = app_user_id() OR app_is_system())
    WITH CHECK (user_id = app_user_id() OR app_is_system());

-- Audit trails: anyone may append; only system context may read.
CREATE POLICY ral_insert ON regulatory_audit_logs FOR INSERT WITH CHECK (TRUE);
CREATE POLICY ral_read   ON regulatory_audit_logs FOR SELECT USING (app_is_system());
CREATE POLICY ral_purge  ON regulatory_audit_logs FOR DELETE USING (app_is_system());
CREATE POLICY pca_insert ON popia_consent_audit   FOR INSERT WITH CHECK (TRUE);
CREATE POLICY pca_read   ON popia_consent_audit   FOR SELECT USING (user_id = app_user_id() OR app_is_system());

-- ---------------------------------------------------------------------------
-- Grants for the application role (no ownership, so RLS always applies)
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA credisync TO credisync_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA credisync TO credisync_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA credisync TO credisync_app;
GRANT EXECUTE ON FUNCTION ensure_transactions_partition(INT) TO credisync_app;
-- Audit trails are append-only for the app role.
REVOKE UPDATE ON regulatory_audit_logs FROM credisync_app;
REVOKE UPDATE, DELETE ON popia_consent_audit FROM credisync_app;

-- ---------------------------------------------------------------------------
-- Views (security_invoker so the caller's RLS context applies)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_active_credit_profiles WITH (security_invoker = true) AS
SELECT
    cp.id,
    cp.user_id,
    cp.unified_score,
    cp.unified_score_band,
    cp.transunion_score,
    cp.transunion_score_band,
    cp.transunion_fetched_at,
    cp.experian_score,
    cp.experian_score_band,
    cp.experian_fetched_at,
    cp.xds_score,
    cp.xds_score_band,
    cp.xds_fetched_at,
    cp.total_accounts,
    cp.open_accounts,
    cp.adverse_accounts,
    cp.judgements_count,
    cp.defaults_count,
    cp.enquiries_last_12m,
    cp.total_credit_exposure,
    cp.monthly_instalment,
    cp.bank_readiness_score,
    cp.bank_readiness_tier,
    cp.updated_at AS last_refreshed_at
FROM credit_profiles cp
WHERE cp.is_current = TRUE;

CREATE OR REPLACE VIEW v_open_disputes WITH (security_invoker = true) AS
SELECT
    d.id             AS dispute_id,
    d.user_id,
    d.status         AS dispute_status,
    d.bureau,
    d.dispute_reason,
    d.submitted_at,
    d.resolution_deadline,
    ba.creditor_name,
    ba.account_type,
    ba.status        AS account_status
FROM disputes d
JOIN bureau_accounts ba ON ba.id = d.bureau_account_id
WHERE d.status NOT IN ('resolved_upheld', 'resolved_rejected');

GRANT SELECT ON v_active_credit_profiles, v_open_disputes TO credisync_app;

-- ---------------------------------------------------------------------------
-- Comments (data dictionary for compliance documentation)
-- ---------------------------------------------------------------------------
COMMENT ON TABLE users                     IS 'Core user profiles. SA ID stored encrypted per POPIA data minimisation principle.';
COMMENT ON TABLE user_sessions             IS 'Refresh-token sessions; only token hashes are stored.';
COMMENT ON TABLE credit_profiles           IS 'Unified multi-bureau credit profile per user after entity resolution.';
COMMENT ON TABLE bureau_accounts           IS 'Individual credit accounts exactly as reported per bureau, linked into clusters by entity resolution.';
COMMENT ON TABLE open_banking_links        IS 'Encrypted provider access tokens from the open-banking consent flow.';
COMMENT ON TABLE financial_health_snapshots IS 'Monthly-normalised open-banking transaction analytics per period.';
COMMENT ON TABLE transactions              IS 'Individual bank transactions ingested via Stitch/Ozow open banking APIs. Partitioned by year.';
COMMENT ON TABLE disputes                  IS 'NCA/NCR-compliant credit bureau dispute records.';
COMMENT ON TABLE data_deletion_requests    IS 'POPIA s24 erasure requests and their completion.';
COMMENT ON TABLE regulatory_audit_logs     IS 'Immutable POPIA compliance audit trail. Append-only.';
COMMENT ON TABLE popia_consent_audit       IS 'Granular consent change history per POPIA Section 11.';

COMMENT ON COLUMN users.sa_id_encrypted    IS 'AES-256-GCM envelope (JSON, UTF-8) of the SA ID. Data key wrapped by AWS KMS. Never log in plaintext.';
COMMENT ON COLUMN users.sa_id_hash         IS 'Keyed HMAC-SHA256 of SA ID for indexed lookup without decryption.';
COMMENT ON COLUMN disputes.resolution_deadline IS '20 business days from submission (NCA s72 and regulations; verify with counsel).';
