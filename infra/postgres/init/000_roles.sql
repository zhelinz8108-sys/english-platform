\set ON_ERROR_STOP on

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'english_app') THEN
    CREATE ROLE english_app
      LOGIN PASSWORD 'english_app'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE english_app
      LOGIN PASSWORD 'english_app'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'english_worker') THEN
    CREATE ROLE english_worker
      LOGIN PASSWORD 'english_worker'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE english_worker
      LOGIN PASSWORD 'english_worker'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'english_outbox_owner') THEN
    CREATE ROLE english_outbox_owner
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  ELSE
    ALTER ROLE english_outbox_owner
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'english_assessment_owner') THEN
    CREATE ROLE english_assessment_owner
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  ELSE
    ALTER ROLE english_assessment_owner
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  END IF;
END;
$roles$;

ALTER ROLE english_app SET row_security = on;
ALTER ROLE english_worker SET row_security = on;
ALTER ROLE english_app SET statement_timeout = '15s';
ALTER ROLE english_worker SET statement_timeout = '60s';
ALTER ROLE english_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE english_worker SET idle_in_transaction_session_timeout = '60s';

GRANT CONNECT ON DATABASE english_platform TO english_app, english_worker;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION english_owner;
CREATE SCHEMA IF NOT EXISTS platform AUTHORIZATION english_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA app, platform FROM PUBLIC;
