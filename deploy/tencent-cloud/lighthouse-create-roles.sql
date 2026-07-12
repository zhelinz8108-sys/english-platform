\set ON_ERROR_STOP on

SELECT format(
  'CREATE ROLE english_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'APP_DB_PASSWORD'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'english_app')
\gexec

SELECT format(
  'CREATE ROLE english_worker LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'WORKER_DB_PASSWORD'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'english_worker')
\gexec

SELECT 'CREATE ROLE english_outbox_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'english_outbox_owner')
\gexec

SELECT 'CREATE ROLE english_assessment_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'english_assessment_owner')
\gexec

SELECT format('ALTER ROLE english_app PASSWORD %L', :'APP_DB_PASSWORD')
\gexec
SELECT format('ALTER ROLE english_worker PASSWORD %L', :'WORKER_DB_PASSWORD')
\gexec

ALTER ROLE english_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE english_worker NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
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
