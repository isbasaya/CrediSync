-- LOCAL DEVELOPMENT ONLY.
-- Creates the login user that services connect as. It is a member of the
-- non-owner role `credisync_app` (created in db/schema.sql), so row-level
-- security policies always apply. Production creates its own login users
-- with secrets from AWS Secrets Manager; never reuse this password.
DO $$ BEGIN
    CREATE ROLE credisync_app NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE ROLE credisync_service LOGIN PASSWORD 'credisync_service_dev' IN ROLE credisync_app;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
