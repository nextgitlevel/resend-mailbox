#!/usr/bin/env bash
set -euo pipefail

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  --set=test_password="$RESEND_MAILBOX_TEST_PASSWORD" <<'SQL'
CREATE ROLE resend_mailbox_test
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'test_password';
CREATE DATABASE resend_mailbox_test OWNER postgres;
GRANT CONNECT, TEMPORARY, CREATE ON DATABASE resend_mailbox_test TO resend_mailbox_test;
\connect resend_mailbox_test
GRANT USAGE, CREATE ON SCHEMA public TO resend_mailbox_test;
SQL
