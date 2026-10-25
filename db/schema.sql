-- =============================================================================
-- CrediSync Core Database Schema
-- PostgreSQL 15+  |  AWS Africa (Cape Town) ap-south-1
--
-- Regulatory alignment:
--   • Protection of Personal Information Act (POPIA) – data minimisation,
--     consent tracking, purpose limitation, data-subject access logs.
--   • National Credit Act (NCA) – credit bureau data retention limits,
--     dispute workflow records.
--
-- Security:
--   • SA ID numbers stored encrypted via pgcrypto (AES-256-CBC).
--   • Row-level security (RLS) policies are defined on sensitive tables.
--   • All timestamps are stored in UTC.
--
-- Status enum values in this schema are the single source of truth and map
-- 1-to-1 to the design tokens in design-system/tokens.ts:
--   score_band      → ScoreBand type (excellent | good | fair | poor | very_poor)
--   account_status  → AccountStatus type
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid(), encrypt()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- fuzzy search for entity resolution
CREATE EXTENSION IF NOT EXISTS "btree_gin";  -- composite GIN indexes

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
    'written_off'   -- slate (neutral)
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

-- Regulatory audit event types
CREATE TYPE audit_event_type AS ENUM (
    'user_registered',
    'user_login',
    'user_logout',
    'consent_granted',
    'consent_revoked',
    'data_access',          -- subject accessed their own data
    'data_export',          -- POPIA Section 23 data-subject access request
    'data_deletion_request',
    'bureau_pull',
    'bank_data_ingested',
    'dispute_created',
    'dispute_submitted',
    'score_computed',
    'ai_entity_merge',
    'admin_access'
);

-- ---------------------------------------------------------------------------
-- Schema namespaces
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS credisync;
SET search_path TO credisync, public;

-- ---------------------------------------------------------------------------
-- Table: users
--
-- Core user profile.  SA ID stored encrypted; never stored in plaintext.
-- All POPIA consent flags are explicit boolean columns so queries remain
-- efficient; a companion audit log records every change.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Contact
    email                   TEXT        NOT NULL UNIQUE,
    mobile_number           TEXT        NOT NULL,           -- E.164 format e.g. +27821234567
    first_name              TEXT        NOT NULL,
    last_name               TEXT        NOT NULL,

    -- SA ID stored encrypted with pgcrypto; key managed via AWS KMS envelope
    -- Application layer must decrypt before use; never log in plaintext.
    sa_id_encrypted         BYTEA       NOT NULL,
    sa_id_hash              TEXT        NOT NULL UNIQUE,    -- SHA-256 HMAC for lookup only

    -- POPIA consent flags (Section 11 – lawful processing basis)
    popia_consent_granted   BOOLEAN     NOT NULL DEFAULT FALSE,
    popia_consent_date      TIMESTAMPTZ,
    marketing_consent       BOOLEAN     NOT NULL DEFAULT FALSE,
    third_party_sharing     BOOLEAN     NOT NULL DEFAULT FALSE,
    open_banking_consent    BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Authentication
    auth_provider           TEXT        NOT NULL DEFAULT 'email', -- email | google | apple
    is_verified             BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active               BOOLEAN     NOT NULL DEFAULT TRUE,
    failed_login_attempts   SMALLINT    NOT NULL DEFAULT 0,
    locked_until            TIMESTAMPTZ,

    -- Metadata
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at           TIMESTAMPTZ,

    CONSTRAINT users_mobile_format CHECK (mobile_number ~ '^\+27[0-9]{9}$'),
    CONSTRAINT users_consent_date  CHECK (
        (popia_consent_granted = TRUE AND popia_consent_date IS NOT NULL)
        OR popia_consent_granted = FALSE
    )
);

-- Row-level security: users may only read/update their own row
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_self_access ON users
    USING (id = current_setting('app.current_user_id', TRUE)::UUID);

CREATE INDEX idx_users_email         ON users (email);
CREATE INDEX idx_users_sa_id_hash    ON users (sa_id_hash);
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
-- Table: credit_profiles
--
-- Unified multi-bureau credit profile for a user after entity resolution.
-- One active row per user; historical snapshots preserved via versioning.
-- ---------------------------------------------------------------------------
CREATE TABLE credit_profiles (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Unified / resolved scores (post entity-resolution merge)
    unified_score           SMALLINT,                        -- 0–999
    unified_score_band      score_band,
    entity_resolution_ver   SMALLINT    NOT NULL DEFAULT 1,  -- AI merge version

    -- Per-bureau scores (nullable if bureau not yet fetched)
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

    -- Bank-readiness predictive score (AI model output, 0–100)
    bank_readiness_score    NUMERIC(5,2),
    bank_readiness_tier     TEXT,   -- 'prime' | 'near_prime' | 'sub_prime' | 'unqualified'

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

ALTER TABLE credit_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY cp_owner_access ON credit_profiles
    USING (user_id = current_setting('app.current_user_id', TRUE)::UUID);

CREATE INDEX idx_cp_user_current  ON credit_profiles (user_id, is_current);
CREATE INDEX idx_cp_unified_score ON credit_profiles (unified_score) WHERE is_current = TRUE;

-- ---------------------------------------------------------------------------
-- Table: bureau_accounts
--
-- Individual credit accounts as reported by each bureau.
-- Linked to credit_profiles; one row per account per bureau.
-- ---------------------------------------------------------------------------
CREATE TABLE bureau_accounts (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    credit_profile_id       UUID        NOT NULL REFERENCES credit_profiles(id) ON DELETE CASCADE,

    bureau                  bureau_source NOT NULL,
    account_reference       TEXT        NOT NULL,   -- obfuscated by bureau
    creditor_name           TEXT        NOT NULL,
    account_type            TEXT        NOT NULL,   -- e.g. 'home_loan', 'credit_card', 'clothing'
    status                  account_status NOT NULL,
    opened_date             DATE,
    closed_date             DATE,
    credit_limit            NUMERIC(14,2),
    current_balance         NUMERIC(14,2) NOT NULL DEFAULT 0,
    overdue_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
    instalment_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
    months_in_arrears       SMALLINT    NOT NULL DEFAULT 0,
    worst_status_12m        account_status,
    payment_profile         CHAR(24),               -- 24-month rolling payment string

    -- Entity resolution: links across bureaus to same real-world account
    resolved_account_id     UUID,                   -- FK to self (nullable)
    resolution_confidence   NUMERIC(4,3),           -- 0.000–1.000

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (credit_profile_id, bureau, account_reference)
);

CREATE INDEX idx_ba_profile      ON bureau_accounts (credit_profile_id);
CREATE INDEX idx_ba_status       ON bureau_accounts (status);
CREATE INDEX idx_ba_resolved     ON bureau_accounts (resolved_account_id) WHERE resolved_account_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Table: financial_health_snapshots
--
-- Aggregated open-banking / transaction data ingested via Stitch or Ozow.
-- One snapshot per ingestion run; historical rows retained for trend analysis.
-- ---------------------------------------------------------------------------
CREATE TABLE financial_health_snapshots (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Snapshot period
    period_start            DATE        NOT NULL,
    period_end              DATE        NOT NULL,
    ingestion_source        TEXT        NOT NULL DEFAULT 'stitch',  -- 'stitch' | 'ozow'

    -- Income metrics
    gross_income            NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_income              NUMERIC(14,2) NOT NULL DEFAULT 0,
    income_streams          SMALLINT    NOT NULL DEFAULT 0,
    income_regularity_score NUMERIC(4,3),   -- 0–1: how consistent income is

    -- Expense categories (ZAR totals for period)
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

    -- Bank-readiness inputs
    affordability_surplus   NUMERIC(14,2),  -- net income − total committed expenses
    nca_nett_income         NUMERIC(14,2),  -- NCA-defined net income calculation

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fhs_period_order CHECK (period_end >= period_start)
);

ALTER TABLE financial_health_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY fhs_owner_access ON financial_health_snapshots
    USING (user_id = current_setting('app.current_user_id', TRUE)::UUID);

CREATE INDEX idx_fhs_user_period ON financial_health_snapshots (user_id, period_end DESC);

-- ---------------------------------------------------------------------------
-- Table: transactions
--
-- Individual bank transactions ingested via open banking.
-- Partitioned by year for performance at scale.
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
    id                      UUID        NOT NULL DEFAULT gen_random_uuid(),
    snapshot_id             UUID        NOT NULL REFERENCES financial_health_snapshots(id) ON DELETE CASCADE,
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

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

-- Create initial annual partitions
CREATE TABLE transactions_2024 PARTITION OF transactions
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE transactions_2025 PARTITION OF transactions
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE transactions_2026 PARTITION OF transactions
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

CREATE INDEX idx_tx_user_date   ON transactions (user_id, transaction_date DESC);
CREATE INDEX idx_tx_category    ON transactions (user_id, category);
CREATE INDEX idx_tx_snapshot    ON transactions (snapshot_id);

-- ---------------------------------------------------------------------------
-- Table: disputes
--
-- Legal dispute records for NCA/NCR-compliant bureau dispute submissions.
-- Each row tracks one dispute through its full lifecycle.
-- ---------------------------------------------------------------------------
CREATE TABLE disputes (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bureau_account_id       UUID        NOT NULL REFERENCES bureau_accounts(id) ON DELETE RESTRICT,

    bureau                  bureau_source NOT NULL,
    dispute_reason          TEXT        NOT NULL,
    dispute_description     TEXT        NOT NULL,
    supporting_evidence     JSONB       NOT NULL DEFAULT '[]',  -- array of S3 object keys
    status                  dispute_status NOT NULL DEFAULT 'draft',

    -- Generated letter content (NCA-compliant template)
    letter_content          TEXT,
    letter_generated_at     TIMESTAMPTZ,
    letter_version          SMALLINT    NOT NULL DEFAULT 1,

    -- Submission tracking
    submitted_at            TIMESTAMPTZ,
    bureau_reference        TEXT,   -- reference number returned by bureau
    bureau_response         TEXT,
    bureau_responded_at     TIMESTAMPTZ,

    -- NCR escalation
    ncr_case_number         TEXT,
    ncr_escalated_at        TIMESTAMPTZ,

    -- NCA Section 71 – 20 business-day resolution window
    resolution_deadline     DATE,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT dispute_ncr_requires_submission CHECK (
        ncr_escalated_at IS NULL OR submitted_at IS NOT NULL
    )
);

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY disputes_owner_access ON disputes
    USING (user_id = current_setting('app.current_user_id', TRUE)::UUID);

CREATE INDEX idx_disputes_user   ON disputes (user_id, created_at DESC);
CREATE INDEX idx_disputes_status ON disputes (status);

-- ---------------------------------------------------------------------------
-- Table: regulatory_audit_logs
--
-- Immutable append-only log of all data-access and processing events.
-- Required by POPIA Section 22 (notification) and Section 23 (access log).
-- Rows are NEVER updated or deleted; retention: 5 years minimum.
-- ---------------------------------------------------------------------------
CREATE TABLE regulatory_audit_logs (
    id              BIGSERIAL   PRIMARY KEY,
    user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,
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

-- Audit log is append-only; prevent UPDATE and DELETE via trigger
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
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
-- Granular consent change history (POPIA Section 11 requirement).
-- Separate from the main audit log for clear separation of concerns.
-- ---------------------------------------------------------------------------
CREATE TABLE popia_consent_audit (
    id              BIGSERIAL   PRIMARY KEY,
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_type    TEXT        NOT NULL,   -- 'popia' | 'marketing' | 'third_party' | 'open_banking'
    previous_value  BOOLEAN,
    new_value       BOOLEAN     NOT NULL,
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
-- Views
-- ---------------------------------------------------------------------------

-- Active credit profile with all bureau scores (convenience view for API layer)
CREATE OR REPLACE VIEW v_active_credit_profiles AS
SELECT
    cp.id,
    cp.user_id,
    u.first_name,
    u.last_name,
    cp.unified_score,
    cp.unified_score_band,
    cp.transunion_score,
    cp.transunion_score_band,
    cp.experian_score,
    cp.experian_score_band,
    cp.xds_score,
    cp.xds_score_band,
    cp.total_accounts,
    cp.open_accounts,
    cp.adverse_accounts,
    cp.judgements_count,
    cp.defaults_count,
    cp.enquiries_last_12m,
    cp.total_credit_exposure,
    cp.bank_readiness_score,
    cp.bank_readiness_tier,
    cp.updated_at AS last_refreshed_at
FROM credit_profiles cp
JOIN users u ON u.id = cp.user_id
WHERE cp.is_current = TRUE;

-- Open disputes per user with bureau account details
CREATE OR REPLACE VIEW v_open_disputes AS
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

-- ---------------------------------------------------------------------------
-- Comments (data dictionary for compliance documentation)
-- ---------------------------------------------------------------------------
COMMENT ON TABLE users                     IS 'Core user profiles. SA ID stored encrypted per POPIA data minimisation principle.';
COMMENT ON TABLE credit_profiles           IS 'Unified multi-bureau credit profile per user after AI entity resolution.';
COMMENT ON TABLE bureau_accounts           IS 'Individual credit accounts as reported per bureau, pre and post entity resolution.';
COMMENT ON TABLE financial_health_snapshots IS 'Aggregated open-banking transaction analytics per time period.';
COMMENT ON TABLE transactions              IS 'Individual bank transactions ingested via Stitch/Ozow open banking APIs. Partitioned by year.';
COMMENT ON TABLE disputes                  IS 'NCA/NCR-compliant credit bureau dispute records.';
COMMENT ON TABLE regulatory_audit_logs     IS 'Immutable POPIA compliance audit trail. Append-only.';
COMMENT ON TABLE popia_consent_audit       IS 'Granular consent change history per POPIA Section 11.';

COMMENT ON COLUMN users.sa_id_encrypted    IS 'AES-256-CBC encrypted SA ID number. Key managed via AWS KMS. Never log in plaintext.';
COMMENT ON COLUMN users.sa_id_hash         IS 'HMAC-SHA256 of SA ID for indexed lookup without decryption.';
COMMENT ON COLUMN disputes.resolution_deadline IS 'NCA Section 71 – 20 business days from submission date.';
