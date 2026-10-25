-- Migration: initial_schema
-- Created: 2024-01-01T00:00:00Z
-- This migration represents the initial state from db/schema.sql

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Enums
DO $$ BEGIN CREATE TYPE score_band AS ENUM ('excellent', 'good', 'fair', 'poor', 'very_poor'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE account_status AS ENUM ('current', 'arrears', 'default', 'judgement', 'written_off'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE bureau_source AS ENUM ('transunion', 'experian', 'xds'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE dispute_status AS ENUM ('draft', 'submitted', 'under_review', 'resolved_upheld', 'resolved_rejected', 'escalated_ncr'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE transaction_category AS ENUM ('income', 'housing', 'transport', 'food_groceries', 'utilities', 'insurance', 'debt_repayment', 'savings', 'entertainment', 'healthcare', 'education', 'gambling', 'transfers', 'other'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE audit_event_type AS ENUM ('user_registered', 'user_login', 'user_logout', 'consent_granted', 'consent_revoked', 'data_access', 'data_export', 'data_deletion_request', 'bureau_pull', 'bank_data_ingested', 'dispute_created', 'dispute_submitted', 'score_computed', 'ai_entity_merge', 'admin_access'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Schema namespace
CREATE SCHEMA IF NOT EXISTS credisync;

-- Table: users
CREATE TABLE IF NOT EXISTS credisync.users (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email                   TEXT        NOT NULL UNIQUE,
    mobile_number           TEXT        NOT NULL,
    first_name              TEXT        NOT NULL,
    last_name               TEXT        NOT NULL,
    sa_id_encrypted         BYTEA       NOT NULL,
    sa_id_hash              TEXT        NOT NULL UNIQUE,
    popia_consent_granted   BOOLEAN     NOT NULL DEFAULT FALSE,
    popia_consent_date      TIMESTAMPTZ,
    marketing_consent       BOOLEAN     NOT NULL DEFAULT FALSE,
    third_party_sharing     BOOLEAN     NOT NULL DEFAULT FALSE,
    open_banking_consent    BOOLEAN     NOT NULL DEFAULT FALSE,
    auth_provider           TEXT        NOT NULL DEFAULT 'email',
    is_verified             BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active               BOOLEAN     NOT NULL DEFAULT TRUE,
    failed_login_attempts   SMALLINT    NOT NULL DEFAULT 0,
    locked_until            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at           TIMESTAMPTZ,
    CONSTRAINT users_mobile_format CHECK (mobile_number ~ '^\+27[0-9]{9}$'),
    CONSTRAINT users_consent_date CHECK (
        (popia_consent_granted = TRUE AND popia_consent_date IS NOT NULL)
        OR popia_consent_granted = FALSE
    )
);

-- Table: user_passwords
CREATE TABLE IF NOT EXISTS credisync.user_passwords (
    user_id         UUID        PRIMARY KEY REFERENCES credisync.users(id) ON DELETE CASCADE,
    password_hash   TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for users
CREATE INDEX IF NOT EXISTS idx_users_email ON credisync.users (email);
CREATE INDEX IF NOT EXISTS idx_users_sa_id_hash ON credisync.users (sa_id_hash);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON credisync.users (created_at);

-- @rollback
-- DROP TABLE IF EXISTS credisync.user_passwords CASCADE;
-- DROP TABLE IF EXISTS credisync.users CASCADE;
-- DROP TYPE IF EXISTS audit_event_type CASCADE;
-- DROP TYPE IF EXISTS transaction_category CASCADE;
-- DROP TYPE IF EXISTS dispute_status CASCADE;
-- DROP TYPE IF EXISTS bureau_source CASCADE;
-- DROP TYPE IF EXISTS account_status CASCADE;
-- DROP TYPE IF EXISTS score_band CASCADE;
